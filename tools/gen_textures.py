#!/usr/bin/env python3
"""Procedural texture generator for the 3D golf view.

Writes seamless (wrap-around) textures into assets/tex/.  Everything is
procedural and deterministic (fixed seeds), so the output is reproducible and
free of third-party licences (CC0 / public domain).

    pip install --user pillow numpy scipy
    python3 tools/gen_textures.py            # all textures
    python3 tools/gen_textures.py grass_rough sand   # only some

Conventions
  * Detail maps (grass_*, sand, soil, macro) are near-neutral grey with a
    per-channel mean of 0.5 (128).  The shader does  base * detail * 2.
    Load them as linear data (no sRGB decode) so 128 means 0.5 in the shader.
  * Normal maps are tangent space, OpenGL convention (+X right, +Y up the
    image, i.e. green = up), flat = (128, 128, 255).
  * Everything tiles in both axes: all noise is built with FFTs on the torus
    and all strokes/dots are drawn with wrap-around.
"""
import os
import sys
import time

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "tex")

NORMAL_Q = 82  # webp quality for normal maps
LUMA = np.array([0.2126, 0.7152, 0.0722])
BAKE_L = np.array([-0.35, 0.45, 0.82]) / np.linalg.norm([-0.35, 0.45, 0.82])  # baked light, upper left


# --------------------------------------------------------------------------
# periodic noise helpers
# --------------------------------------------------------------------------

def _freqs(h, w, ax=1.0, ay=1.0):
    fy = np.fft.fftfreq(h)[:, None] * h * ay
    fx = np.fft.fftfreq(w)[None, :] * w * ax
    return np.sqrt(fx * fx + fy * fy)


def noise_fbm(rng, h, w, f_lo=1.0, f_hi=64.0, beta=1.0, ax=1.0, ay=1.0):
    """Periodic fractal noise; frequencies in cycles per tile.  ax/ay stretch
    the noise (ay > 1 makes features ay times longer vertically)."""
    f = _freqs(h, w, ax, ay)
    amp = np.where(f > 0, np.power(np.maximum(f, 1e-6), -beta), 0.0)
    soft = 1.0 / (1.0 + np.exp(np.clip(-(f - f_lo) * 2.0, -60, 60))) * (1.0 / (1.0 + np.exp(np.clip((f - f_hi) / max(f_hi * 0.08, 0.5), -60, 60))))
    amp = amp * soft
    wn = np.fft.fft2(rng.standard_normal((h, w)))
    n = np.real(np.fft.ifft2(wn * amp))
    n -= n.mean()
    return n / (n.std() + 1e-12)


def noise_band(rng, h, w, f0, bw, ax=1.0, ay=1.0):
    """Periodic band-pass noise around f0 cycles/tile (gaussian ring)."""
    f = _freqs(h, w, ax, ay)
    amp = np.exp(-0.5 * ((f - f0) / bw) ** 2)
    amp[0, 0] = 0
    wn = np.fft.fft2(rng.standard_normal((h, w)))
    n = np.real(np.fft.ifft2(wn * amp))
    n -= n.mean()
    return n / (n.std() + 1e-12)


def sample_wrap(img, x, y):
    """Bilinear sample of a periodic 2D array at float pixel coords."""
    h, w = img.shape
    x = np.asarray(x) - 0.5
    y = np.asarray(y) - 0.5
    x0 = np.floor(x).astype(int)
    y0 = np.floor(y).astype(int)
    fx = x - x0
    fy = y - y0
    x0 %= w
    y0 %= h
    x1 = (x0 + 1) % w
    y1 = (y0 + 1) % h
    return (img[y0, x0] * (1 - fx) * (1 - fy) + img[y0, x1] * fx * (1 - fy)
            + img[y1, x0] * (1 - fx) * fy + img[y1, x1] * fx * fy)


def blur(a, s, wrap=True):
    mode = "wrap" if wrap else "nearest"
    if a.ndim == 3:
        return np.stack([ndimage.gaussian_filter(a[..., c], s, mode=mode) for c in range(a.shape[2])], -1)
    return ndimage.gaussian_filter(a, s, mode=mode)


def downsample(a, f):
    if f == 1:
        return a
    h, w = a.shape[:2]
    return a.reshape(h // f, f, w // f, f, *a.shape[2:]).mean(axis=(1, 3))


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# --------------------------------------------------------------------------
# stroke rasteriser (z-buffered capsules / tapered segments)
# --------------------------------------------------------------------------

def raster_strokes(H, W, p0, p1, w0, w1, z0, z1, dome, wrap=True, max_chunk=6_000_000):
    """Rasterise N tapered segments (half-widths w0 at p0, w1 at p1) with a
    z-buffer.  Height along a stroke is z0..z1 plus a rounded cross-section
    of height `dome`.  z values must lie in [0, 1).  Coverage is binary per
    pixel: render supersampled and downsample for antialiasing.

    Returns dict with per-pixel: id (-1 = empty), t (0 at p0 .. 1 at p1),
    s (signed lateral position, -1..1), r (radial dist / width), z.
    """
    p0 = np.asarray(p0, float)
    p1 = np.asarray(p1, float)
    N = len(p0)
    w0 = np.broadcast_to(np.asarray(w0, float), (N,))
    w1 = np.broadcast_to(np.asarray(w1, float), (N,))
    z0 = np.broadcast_to(np.asarray(z0, float), (N,))
    z1 = np.broadcast_to(np.asarray(z1, float), (N,))
    dome = np.broadcast_to(np.asarray(dome, float), (N,))
    d = p1 - p0
    L = np.hypot(d[:, 0], d[:, 1])
    mid = (p0 + p1) * 0.5
    R = np.ceil(L * 0.5 + np.maximum(w0, w1) + 1).astype(int)
    zbuf = np.full(H * W, -1, np.int64)
    ZQ = (1 << 24) - 1
    store = []
    for r in np.unique(R):
        ids_r = np.nonzero(R == r)[0]
        o = np.arange(-r, r + 1)
        OY, OX = np.meshgrid(o, o, indexing="ij")
        OX = OX.ravel()
        OY = OY.ravel()
        K = OX.size
        step = max(1, max_chunk // K)
        for c0 in range(0, len(ids_r), step):
            ids = ids_r[c0:c0 + step]
            cx = np.floor(mid[ids, 0]).astype(np.int64)
            cy = np.floor(mid[ids, 1]).astype(np.int64)
            X = cx[:, None] + OX[None, :]
            Y = cy[:, None] + OY[None, :]
            px = X + 0.5 - p0[ids, 0:1]
            py = Y + 0.5 - p0[ids, 1:2]
            dx = d[ids, 0:1]
            dy = d[ids, 1:2]
            L2 = np.maximum(L[ids, None] ** 2, 1e-9)
            t = np.clip((px * dx + py * dy) / L2, 0.0, 1.0)
            ex = px - t * dx
            ey = py - t * dy
            dist = np.sqrt(ex * ex + ey * ey)
            wt = w0[ids, None] + (w1[ids, None] - w0[ids, None]) * t
            inside = dist < wt
            if not wrap:
                inside &= (X >= 0) & (X < W) & (Y >= 0) & (Y < H)
            sel = np.nonzero(inside)
            if sel[0].size == 0:
                continue
            idv = ids[sel[0]]
            Xs = X[sel] % W
            Ys = Y[sel] % H
            ts = t[sel]
            rr = dist[sel] / np.maximum(wt[sel], 1e-6)
            lat = (dx[sel[0], 0] * py[sel] - dy[sel[0], 0] * px[sel]) / np.maximum(L[idv], 1e-6)
            ss = np.clip(lat / np.maximum(wt[sel], 1e-6), -1, 1)
            z = z0[idv] + (z1[idv] - z0[idv]) * ts + dome[idv] * np.sqrt(np.clip(1 - rr * rr, 0, 1))
            zq = (np.clip(z, 0, 0.999999) * ZQ).astype(np.int64)
            pix = Ys * W + Xs
            key = (zq << 24) | idv.astype(np.int64)
            np.maximum.at(zbuf, pix, key)
            store.append((pix.astype(np.int32), idv.astype(np.int32), ts.astype(np.float32),
                          ss.astype(np.float32), rr.astype(np.float32)))
    out_id = np.full(H * W, -1, np.int32)
    out_t = np.zeros(H * W, np.float32)
    out_s = np.zeros(H * W, np.float32)
    out_r = np.ones(H * W, np.float32)
    win = np.where(zbuf >= 0, zbuf & ((1 << 24) - 1), -1)
    for pix, idv, ts, ss, rr in store:
        m = win[pix] == idv
        p = pix[m]
        out_id[p] = idv[m]
        out_t[p] = ts[m]
        out_s[p] = ss[m]
        out_r[p] = rr[m]
    z = np.where(zbuf >= 0, (zbuf >> 24).astype(np.float64) / ZQ, 0.0)
    return dict(id=out_id.reshape(H, W), t=out_t.reshape(H, W), s=out_s.reshape(H, W),
                r=out_r.reshape(H, W), z=z.reshape(H, W).astype(np.float32))


# --------------------------------------------------------------------------
# normal maps / output helpers
# --------------------------------------------------------------------------

def height_to_normal(h, strength, wrap=True):
    """Sobel on a (periodic) height map -> tangent-space normal, OpenGL (+Y up).
    strength is in 'height units per pixel'."""
    if wrap:
        r = lambda a, dy, dx: np.roll(np.roll(a, dy, 0), dx, 1)
    else:
        def r(a, dy, dx):
            p = np.pad(a, 1, mode="edge")
            return p[1 - dy:1 - dy + a.shape[0], 1 - dx:1 - dx + a.shape[1]]
    # r(a, dy, dx)[y, x] = a[y - dy, x - dx]
    gx = ((r(h, 1, -1) + 2 * r(h, 0, -1) + r(h, -1, -1)) - (r(h, 1, 1) + 2 * r(h, 0, 1) + r(h, -1, 1))) / 8.0
    gy = ((r(h, -1, 1) + 2 * r(h, -1, 0) + r(h, -1, -1)) - (r(h, 1, 1) + 2 * r(h, 1, 0) + r(h, 1, -1))) / 8.0
    # gx = dh/dx (x right), gy = dh/dy (y down the image)
    nx = -gx * strength
    ny = gy * strength  # +Y up the image
    nz = np.ones_like(h)
    inv = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx * inv, ny * inv, nz * inv], -1)


def normal_to_rgb(n):
    return np.clip(np.round((n * 0.5 + 0.5) * 255), 0, 255).astype(np.uint8)


def to_u8(a):
    return np.clip(np.round(a * 255), 0, 255).astype(np.uint8)


def neutralise(rgb, target_std, chroma_std=0.012, iters=4):
    """Make per-channel mean exactly 0.5 and luminance std = target_std,
    keeping the relative hue deviations but scaling them so their std is
    chroma_std (gentle tint only)."""
    x = rgb.astype(np.float64)
    m = x.reshape(-1, 3).mean(0)
    dev = x - m
    lum_dev = dev @ LUMA
    k = target_std / (lum_dev.std() + 1e-12)
    chroma = dev - lum_dev[..., None]
    cs = np.sqrt((chroma ** 2).mean())
    kc = chroma_std / (cs + 1e-12)
    out = 0.5 + lum_dev[..., None] * k + chroma * kc
    for _ in range(iters):
        out = np.clip(out, 0, 1)
        out += 0.5 - out.reshape(-1, 3).mean(0)
    return np.clip(out, 0, 1)


def save_webp(arr, name, quality=88, lossless=False):
    path = os.path.join(OUT, name + ".webp")
    if lossless:
        Image.fromarray(arr).save(path, "WEBP", lossless=True, quality=100, method=6)
    else:
        Image.fromarray(arr).save(path, "WEBP", quality=quality, method=6)
    return path


def save_png(arr, name):
    path = os.path.join(OUT, name + ".png")
    mode = "RGBA" if arr.ndim == 3 and arr.shape[2] == 4 else ("RGB" if arr.ndim == 3 else "L")
    Image.fromarray(arr, mode).save(path, "PNG", optimize=True)
    return path


def bleed_rgb(rgb, alpha, radius=16, fill=None):
    """Fill RGB of (nearly) transparent pixels with the colour of the nearest
    opaque-ish pixels (dilated outward ~radius px), then the mean colour."""
    rgb = rgb.copy()
    solid = alpha > 0.5
    if fill is None:
        fill = rgb[solid].mean(0) if solid.any() else np.array([0.5, 0.5, 0.5])
    # nearest-solid-pixel colour via distance transform indices
    if solid.any():
        _, (iy, ix) = ndimage.distance_transform_edt(~solid, return_indices=True)
        near = rgb[iy, ix]
        dist = ndimage.distance_transform_edt(~solid)
        wgt = np.clip(1 - dist / radius, 0, 1)[..., None]
        bleed = near * wgt + fill * (1 - wgt)
        bleed = blur(bleed, 2.0, wrap=False)
        rgb = np.where(solid[..., None], rgb, bleed)
    return rgb


# --------------------------------------------------------------------------
# grass detail
# --------------------------------------------------------------------------

def gen_grass(name, size, seed, n_blades, length, width, lean, lean_spread,
              target_std, normal_strength, clumps=None, ss=2, gap_dark=0.30,
              patch_amp=0.06, tip_warm=0.10):
    rng = np.random.default_rng(seed)
    S = size * ss
    # positions (optionally clumped)
    if clumps:
        n_c, c_rad, frac = clumps
        n_cl = int(n_blades * frac)
        cc = rng.random((n_c, 2)) * S
        which = rng.integers(0, n_c, n_cl)
        rad = np.abs(rng.normal(0, c_rad * ss, n_cl))
        ang = rng.random(n_cl) * 2 * np.pi
        pc = cc[which] + np.stack([np.cos(ang), np.sin(ang)], 1) * rad[:, None] * 0.9
        # each tuft flops over in its own direction, with some outward splay
        cdir = lean + rng.normal(0, 1.3, n_c)
        radial = rng.random(n_cl) < 0.0
        a_cl = np.where(radial, ang, cdir[which]) + rng.normal(0, 0.5, n_cl)
        pr = rng.random((n_blades - n_cl, 2)) * S
        a_r = lean + rng.normal(0, lean_spread, n_blades - n_cl)
        pos = np.concatenate([pc, pr])
        angs = np.concatenate([a_cl, a_r])
        in_clump = np.concatenate([np.ones(n_cl, bool), np.zeros(n_blades - n_cl, bool)])
        cdist = np.concatenate([rad / (c_rad * ss), np.zeros(n_blades - n_cl)])
    else:
        pos = rng.random((n_blades, 2)) * S
        # mixture: most blades follow the mowing lean, some random
        mix = rng.random(n_blades) < 0.85
        angs = np.where(mix, lean + rng.normal(0, lean_spread, n_blades), rng.random(n_blades) * 2 * np.pi)
        in_clump = np.zeros(n_blades, bool)
        cdist = np.zeros(n_blades)
    N = len(pos)
    Lb = length[0] + (length[1] - length[0]) * rng.random(N) ** 1.3
    if clumps:
        Lb = np.where(in_clump, Lb * (1.0 + 0.5 * np.clip(1 - cdist, 0, 1)), Lb * 0.8)
    Lb *= ss
    Wb = (width[0] + (width[1] - width[0]) * rng.random(N)) * ss * 0.5
    dirv = np.stack([np.cos(angs), np.sin(angs)], 1)
    p0 = pos
    p1 = pos + dirv * Lb[:, None]
    # heights: blades rise toward the tip (seen from a grazing angle)
    zb = rng.random(N) * 0.35
    if clumps:
        zc = np.clip(1 - cdist, 0, 1)
        z0 = np.where(in_clump, 0.25 + 0.25 * zc + zb * 0.4, zb)
        z1 = np.where(in_clump, 0.45 + 0.3 * zc + zb * 0.4, zb + 0.4)
    else:
        z0 = zb
        z1 = zb + 0.5
    dome = np.full(N, 0.08)
    order = rng.permutation(N)
    res = raster_strokes(S, S, p0[order], p1[order], Wb[order], Wb[order] * 0.12,
                         np.clip(z0[order], 0, 0.85), np.clip(z1[order], 0, 0.88), dome[order], wrap=True)
    idm = res["id"]
    filled = idm >= 0
    ids = np.where(filled, idm, 0)
    t = res["t"]
    s = res["s"]

    # per-blade colour variation
    patches = noise_fbm(rng, 256, 256, 6, 40, 1.0)
    bp = p0[order]
    patch_v = sample_wrap(patches, bp[:, 0] / S * 256, bp[:, 1] / S * 256)
    lum = 1.0 + rng.normal(0, 0.07, N) + patch_amp * patch_v
    warm = rng.normal(0, 0.03, N) + 0.03 * patch_v
    ang_o = angs[order]
    light = np.array([0.55, -0.83])  # light from upper right
    perp = np.stack([-np.sin(ang_o), np.cos(ang_o)], 1)
    side = perp @ light

    tt = t
    shade = (0.62 + 0.45 * np.power(tt, 0.8)) * lum[ids]
    shade *= 1.0 + 0.16 * s * side[ids]
    shade *= 1.0 - 0.10 * np.abs(s) ** 3
    tipw = smoothstep(0.55, 1.0, tt) * tip_warm + warm[ids]
    base = np.array([0.93, 1.0, 0.90])
    col = np.empty((S, S, 3), np.float32)
    col[..., 0] = shade * (base[0] + tipw)
    col[..., 1] = shade * (base[1] + 0.4 * tipw)
    col[..., 2] = shade * (base[2] - tipw * 0.8)

    # gaps between blades: dark, slightly cool, with soil-ish noise
    gn = noise_fbm(rng, S, S, 8, S / 3, 0.8)
    g = gap_dark * (1 + 0.15 * gn)
    gap = np.stack([g * 0.92, g * 1.0, g * 1.06], -1)
    col = np.where(filled[..., None], col, gap)

    hmap = np.where(filled, res["z"], -0.15 + 0.03 * gn)
    col = downsample(col, ss)
    hmap = downsample(hmap.astype(np.float64), ss)
    alb = neutralise(col, target_std, chroma_std=0.09 * target_std)
    nrm = height_to_normal(blur(hmap, 0.6), normal_strength)
    return alb, nrm, hmap


def normal_target(h, target, wrap=True):
    """Normal map from height with strength chosen so std(|n.xy|) ~ target."""
    n1 = height_to_normal(h, 1.0, wrap)
    g = np.sqrt(n1[..., 0] ** 2 + n1[..., 1] ** 2) / n1[..., 2]
    k = target / (np.sqrt((g ** 2).mean()) + 1e-12)
    return height_to_normal(h, k, wrap)


# --------------------------------------------------------------------------
# sand / soil / macro
# --------------------------------------------------------------------------

def gen_sand(seed=21, size=1024, ss=2):
    rng = np.random.default_rng(seed)
    S = size * ss
    n = 170_000
    pos = rng.random((n, 2)) * S
    rad = (0.55 + 1.15 * rng.random(n) ** 2.2) * ss
    z0 = rng.random(n) * 0.55
    res = raster_strokes(S, S, pos, pos + 0.01, rad, rad, z0, z0, 0.3, wrap=True)
    idm = res["id"]
    filled = idm >= 0
    ids = np.where(filled, idm, 0)
    lum = 1.0 + rng.normal(0, 0.05, n)
    kind = rng.random(n)
    lum = np.where(kind < 0.025, lum * 0.72, lum)          # dark mineral grains
    lum = np.where(kind > 0.975, lum * 1.22, lum)          # bright quartz grains
    warm = rng.normal(0, 0.02, n) + np.where(kind < 0.035, -0.03, 0)
    rr = res["r"]
    shade = lum[ids] * (1.0 - 0.18 * rr ** 2)
    col = np.stack([shade * (1 + warm[ids]), shade, shade * (1 - warm[ids])], -1)
    fine = noise_fbm(rng, S, S, 16, S / 2, 0.6)
    gap = 0.80 + 0.04 * fine
    col = np.where(filled[..., None], col, np.stack([gap * 0.99, gap, gap * 1.01], -1))
    hgr = np.where(filled, res["z"], 0.0)
    lit = height_to_normal(hgr, 3.0) @ BAKE_L
    col = col * (0.80 + 0.22 * lit)[..., None]
    col = downsample(col, ss)
    hgr = downsample(hgr.astype(np.float64), ss)

    # wind ripples: integer wave vector so they tile; warped by periodic noise
    yy, xx = np.mgrid[0:size, 0:size] / size
    warp = noise_fbm(rng, size, size, 1, 6, 1.5)
    kx, ky = 3, 8
    phase = 2 * np.pi * (kx * xx + ky * yy) + 1.4 * warp
    rip = np.sin(phase + 0.45 * np.sin(phase))            # skewed profile
    ampm = 0.55 + 0.45 * noise_fbm(rng, size, size, 1, 4, 1.5)
    rip *= np.clip(ampm, 0.1, 1.2)
    soft = noise_fbm(rng, size, size, 6, 60, 1.0)
    lum_mod = 1.0 + 0.03 * rip + 0.012 * soft
    col = col * lum_mod[..., None]
    alb = neutralise(col, 0.075, chroma_std=0.008)
    h = hgr * 0.35 + rip * 2.2 + soft * 0.15
    nrm = height_to_normal(blur(h, 0.5), 1.4)
    return alb, nrm


def gen_soil(seed=31, size=512, ss=2):
    rng = np.random.default_rng(seed)
    S = size * ss
    mud = noise_fbm(rng, S, S, 4, S / 3, 1.0)
    # pebbles: rounded capsules
    n = 950
    pos = rng.random((n, 2)) * S
    r = (2.5 + 9.0 * rng.random(n) ** 2.2) * ss
    ang = rng.random(n) * np.pi
    el = rng.random(n) * 0.9 * r
    d = np.stack([np.cos(ang), np.sin(ang)], 1) * el[:, None]
    zq = np.clip(r / (9 * ss), 0, 1)
    z0 = 0.15 + 0.3 * rng.random(n) * (0.5 + zq)
    # grit
    m = 5000
    gpos = rng.random((m, 2)) * S
    gr = (0.5 + 0.9 * rng.random(m)) * ss
    P0 = np.concatenate([pos - d * 0.5, gpos])
    P1 = np.concatenate([pos + d * 0.5, gpos + 0.01])
    R = np.concatenate([r, gr])
    Z0 = np.concatenate([z0, rng.random(m) * 0.3])
    dome = np.concatenate([0.35 * (0.4 + zq), np.full(m, 0.06)])
    res = raster_strokes(S, S, P0, P1, R, R, Z0, Z0, dome, wrap=True)
    idm = res["id"]
    filled = idm >= 0
    ids = np.where(filled, idm, 0)
    N = n + m
    lum = np.concatenate([0.92 + rng.normal(0, 0.10, n), 0.72 + rng.normal(0, 0.08, m)])
    hue = np.concatenate([rng.normal(0.02, 0.012, n), rng.normal(0, 0.01, m)])
    rr = res["r"]
    hs = np.where(filled, res["z"], 0.05 + 0.03 * mud)
    lit = height_to_normal(blur(hs, 1.0), 30.0) @ BAKE_L
    shade = lum[ids] * (1.05 - 0.30 * rr ** 3) * (0.78 + 0.3 * lit)
    col = np.stack([shade * (1 + hue[ids]), shade, shade * (1 - hue[ids] * 1.2)], -1)
    mudc = 0.66 + 0.06 * mud
    col = np.where(filled[..., None], col, np.stack([mudc * 1.02, mudc, mudc * 0.97], -1))
    h = np.where(filled, res["z"], 0.05 + 0.03 * mud)
    col = downsample(col, ss)
    h = downsample(h.astype(np.float64), ss)
    alb = neutralise(col, 0.12, chroma_std=0.007)
    nrm = height_to_normal(blur(h, 0.7), 6.0)
    return alb, nrm


def gen_macro(seed=41, size=512):
    rng = np.random.default_rng(seed)
    def lowpass(fc):
        f = _freqs(size, size)
        amp = np.exp(-0.5 * (f / fc) ** 2) * (f > 0)
        n = np.real(np.fft.ifft2(np.fft.fft2(rng.standard_normal((size, size))) * amp))
        return (n - n.mean()) / n.std()
    v = lowpass(2.2) + 0.3 * lowpass(5.0)
    v = (v - v.mean()) / v.std()
    return np.clip(0.5 + 0.12 * v, 0, 1)


# --------------------------------------------------------------------------
# bark
# --------------------------------------------------------------------------

def gen_bark(seed=51, W=512, H=1024):
    """Interlaced vertical ridges (two ridged anisotropic noises, max-combined
    so they merge and split like oak/pine bark) over deep dark furrows."""
    rng = np.random.default_rng(seed)
    fine = noise_fbm(rng, H, W, 20, 300, 0.7)
    fine_v = noise_fbm(rng, H, W, 8, 160, 0.8, ax=1, ay=5)
    warp = noise_fbm(rng, H, W, 2, 12, 1.3, ax=1, ay=3)
    r = []
    for f0 in (9, 12):
        c = noise_band(rng, H, W, f0, 3.0, ax=1, ay=5) + 0.25 * warp
        c = c + 0.06 * fine_v + 0.03 * fine
        r.append(1 - np.clip(np.abs(c) / 1.3, 0, 1))
    ridge = np.maximum(r[0], r[1] * 0.92)
    plate = smoothstep(0.30, 0.75, ridge) ** 0.7          # flat-topped ridges
    crack = 1 - smoothstep(0.10, 0.40, ridge + 0.05 * fine)  # deep furrow floor
    # short horizontal fissures across the ridges
    hf = noise_band(rng, H, W, 14, 4, ax=3.5, ay=1)
    hmask = smoothstep(0.4, 1.2, noise_fbm(rng, H, W, 3, 14, 1.2))
    hcrack = (1 - smoothstep(0.0, 0.12, np.abs(hf + 0.05 * fine))) * hmask
    ridges = noise_band(rng, H, W, 30, 8, ax=1, ay=6)
    h = (0.8 * plate + 0.08 * ridges * plate + 0.035 * fine_v + 0.025 * fine
         - 0.25 * crack - 0.3 * hcrack * plate)
    nrm = height_to_normal(blur(h, 0.6), 22.0)
    # colour
    hn = (h - np.percentile(h, 2)) / (np.percentile(h, 99.5) - np.percentile(h, 2))
    hn = np.clip(hn, 0, 1)
    deep = np.array([0.13, 0.085, 0.06])
    mid = np.array([0.40, 0.29, 0.20])
    top = np.array([0.60, 0.48, 0.37])
    t1 = smoothstep(0.0, 0.55, hn)[..., None]
    t2 = smoothstep(0.55, 1.0, hn)[..., None]
    col = deep + (mid - deep) * t1
    col = col + (top - col) * t2
    hue = noise_fbm(rng, H, W, 2, 16, 1.2)[..., None]
    col = col * (1 + 0.05 * hue * np.array([1.0, 0.8, 0.6])) * (1 + 0.025 * fine_v[..., None] + 0.02 * fine[..., None])
    # baked soft light (stylised): light from upper left
    L = np.array([-0.4, 0.5, 0.77])
    L = L / np.linalg.norm(L)
    lit = np.clip(nrm @ L, 0, 1)
    col = col * (0.75 + 0.35 * lit[..., None])
    return np.clip(col, 0, 1), nrm


# --------------------------------------------------------------------------
# water normals
# --------------------------------------------------------------------------

def gen_water(seed=61, size=1024):
    """Soft, rounded ripples: a sum of directional waves with integer wave
    vectors (so it tiles), gently domain-warped by periodic noise."""
    rng = np.random.default_rng(seed)
    yy, xx = (np.mgrid[0:size, 0:size] + 0.5) / size
    wx = noise_fbm(rng, size, size, 1, 5, 1.5)
    wy = noise_fbm(rng, size, size, 1, 5, 1.5)
    h = np.zeros((size, size))
    main = rng.random() * 2 * np.pi
    used = set()
    n = 0
    while n < 28:
        k = 4 + 18 * rng.random() ** 1.6
        ang = main + rng.normal(0, 0.9)
        kx = int(round(k * np.cos(ang)))
        ky = int(round(k * np.sin(ang)))
        if (kx, ky) in used or (kx == 0 and ky == 0):
            continue
        used.add((kx, ky))
        kk = np.hypot(kx, ky)
        amp = kk ** -1.4
        ph = 2 * np.pi * (kx * xx + ky * yy) + rng.random() * 2 * np.pi + 1.2 * (wx * np.cos(ang) + wy * np.sin(ang))
        w = (np.sin(ph) + 1) * 0.5
        h += amp * (w ** 1.6)          # rounded troughs, slightly fuller crests
        n += 1
    h = blur(h, 1.0)
    return normal_target(h, 0.16)


# --------------------------------------------------------------------------
# foliage
# --------------------------------------------------------------------------

LEAF_COL = np.array([0.80, 0.86, 0.74])


class Canvas:
    """Supersampled RGBA + normal canvas for painter's-order leaf drawing."""

    def __init__(self, H, W, wrap=False, bg=None):
        self.H, self.W, self.wrap = H, W, wrap
        self.col = np.zeros((H, W, 3), np.float32)
        self.a = np.zeros((H, W), np.float32)
        self.n = np.zeros((H, W, 3), np.float32)
        self.n[..., 2] = 1
        if bg is not None:
            self.col[:] = bg
            self.a[:] = 1

    def region(self, x0, x1, y0, y1):
        xs = np.arange(int(np.floor(x0)), int(np.ceil(x1)) + 1)
        ys = np.arange(int(np.floor(y0)), int(np.ceil(y1)) + 1)
        if self.wrap:
            xi, yi = xs % self.W, ys % self.H
        else:
            xs = xs[(xs >= 0) & (xs < self.W)]
            ys = ys[(ys >= 0) & (ys < self.H)]
            xi, yi = xs, ys
        X, Y = np.meshgrid(xs + 0.5, ys + 0.5)
        return X, Y, np.ix_(yi, xi)

    def put(self, sl, mask, col, nrm):
        c = self.col[sl]
        n = self.n[sl]
        a = self.a[sl]
        m = mask[..., None]
        self.col[sl] = np.where(m, col, c)
        self.n[sl] = np.where(m, nrm, n)
        self.a[sl] = np.where(mask, 1.0, a)

    def leaf(self, rng, base, ang, L, Wd, colour, depth=1.0, light=(0.5, -0.8), teeth=0,
             vein_n=8, cup=0.25, tilt=(0.0, 0.0), ss=4):
        d = np.array([np.cos(ang), np.sin(ang)])
        p = np.array([-d[1], d[0]])
        tip = base + d * L
        ext = Wd + 2
        x0 = min(base[0], tip[0]) - ext
        x1 = max(base[0], tip[0]) + ext
        y0 = min(base[1], tip[1]) - ext
        y1 = max(base[1], tip[1]) + ext
        X, Y, sl = self.region(x0, x1, y0, y1)
        if X.size == 0:
            return
        rx = X - base[0]
        ry = Y - base[1]
        du = rx * d[0] + ry * d[1]
        dv = rx * p[0] + ry * p[1]
        u = du / L
        uc = np.clip(u, 0, 1)
        shape = np.sin(np.pi * uc ** 0.72) ** 0.85
        if teeth:
            shape = shape * (1 - 0.06 * np.abs(np.sin(uc * teeth * np.pi)) * smoothstep(0.1, 0.3, uc))
        hw = Wd * shape
        av = np.abs(dv)
        mask = (u > 0) & (u < 1) & (av < hw)
        if not mask.any():
            return
        rel = av / np.maximum(hw, 1e-3)
        # shading
        side = np.sign(dv) * (p @ np.array(light))
        sh = (0.90 + 0.12 * uc) * (1 + 0.07 * np.sign(side) * smoothstep(0, 0.15, rel)) * depth
        sh *= 1 - 0.10 * rel ** 4          # darker rim
        midw = (1.3 - 0.9 * uc) * ss * 0.55
        mid = 1 - smoothstep(midw * 0.6, midw, av)
        sp = L / vein_n
        q = du - av * 1.1
        qm = np.mod(q, sp)
        qd = np.minimum(qm, sp - qm) / 1.49
        vw = 0.45 * ss * (1 - 0.6 * rel)
        vein = (1 - smoothstep(vw * 0.5, vw, qd)) * (q > sp * 0.3) * (1 - smoothstep(0.75, 0.95, rel))
        sh = sh * (1 + 0.13 * mid + 0.08 * vein)
        col = colour[None, None, :] * sh[..., None]
        # normals: cupped leaf, grooved veins, per-leaf tilt
        hgt = cup * Wd * (1 - np.clip(rel, 0, 1) ** 2) - 0.5 * ss * mid - 0.35 * ss * vein
        gy, gx = np.gradient(hgt)
        nx = -gx + tilt[0]
        ny = gy + tilt[1]
        nn = np.stack([nx, ny, np.ones_like(nx)], -1)
        nn /= np.linalg.norm(nn, axis=-1, keepdims=True)
        self.put(sl, mask, col, nn)

    def capsule(self, a, b, r0, r1, colour, depth=1.0):
        a = np.asarray(a, float)
        b = np.asarray(b, float)
        ext = max(r0, r1) + 2
        X, Y, sl = self.region(min(a[0], b[0]) - ext, max(a[0], b[0]) + ext,
                               min(a[1], b[1]) - ext, max(a[1], b[1]) + ext)
        if X.size == 0:
            return
        d = b - a
        L2 = max(d @ d, 1e-9)
        t = np.clip(((X - a[0]) * d[0] + (Y - a[1]) * d[1]) / L2, 0, 1)
        ex = X - a[0] - t * d[0]
        ey = Y - a[1] - t * d[1]
        dist = np.sqrt(ex * ex + ey * ey)
        r = r0 + (r1 - r0) * t
        mask = dist < r
        if not mask.any():
            return
        nx = ex / np.maximum(r, 1e-3)
        ny = -ey / np.maximum(r, 1e-3)
        nz = np.sqrt(np.clip(1 - nx * nx - ny * ny, 0.05, 1))
        nn = np.stack([nx * 0.8, ny * 0.8, nz], -1)
        nn /= np.linalg.norm(nn, axis=-1, keepdims=True)
        sh = (0.85 + 0.2 * np.clip(-nx * 0.5 + ny * 0.8, -1, 1)) * depth
        col = np.asarray(colour)[None, None, :] * sh[..., None]
        self.put(sl, mask, col, nn)

    def resolve(self, ss):
        a = downsample(self.a, ss)
        col = downsample(self.col * self.a[..., None], ss) / np.maximum(a[..., None], 1e-6)
        n = downsample(self.n * self.a[..., None], ss)
        n[..., 2] += (1 - a)  # flat where transparent
        n /= np.linalg.norm(n, axis=-1, keepdims=True)
        return col, a, n


def bezier(p0, p1, p2, t):
    t = np.asarray(t)[..., None]
    return (1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t * t * p2


def foliage_leaves(seed=71, size=512, ss=4):
    """Slot 0: spray of broad leaves on a twig, face-on."""
    rng = np.random.default_rng(seed)
    S = size * ss
    cv = Canvas(S, S)
    twig_col = np.array([0.62, 0.62, 0.55])
    # main twig from bottom centre up, a few side shoots
    branches = []
    main = (np.array([0.50, 0.99]), np.array([0.48, 0.6]), np.array([0.52, 0.26]))
    branches.append((main, 0.010, 0.004))
    for (sx, sy, ex, ey) in [(0.49, 0.70, 0.27, 0.45), (0.50, 0.62, 0.73, 0.40), (0.49, 0.84, 0.28, 0.66),
                             (0.50, 0.78, 0.73, 0.62), (0.51, 0.47, 0.37, 0.27), (0.51, 0.44, 0.65, 0.25)]:
        st = np.array([sx, sy])
        en = np.array([ex, ey])
        ctl = (st + en) / 2 + np.array([0, -0.06])
        branches.append(((st, ctl, en), 0.006, 0.003))
    leaves = []
    for bi, ((b0, b1, b2), r0, r1) in enumerate(branches):
        pts = bezier(b0, b1, b2, np.linspace(0, 1, 24)) * S
        for i in range(len(pts) - 1):
            tt = i / (len(pts) - 1)
            cv.capsule(pts[i], pts[i + 1], (r0 + (r1 - r0) * tt) * S, (r0 + (r1 - r0) * (tt + 1 / 23)) * S, twig_col, 0.9)
        # leaves along the branch (alternate sides) and a cluster at the tip
        nl = 3 if bi == 0 else 4
        for k in range(nl):
            tt = 0.35 + 0.65 * (k + rng.random() * 0.3) / nl
            if bi == 0 and tt < 0.6:
                continue
            p = bezier(b0, b1, b2, tt) * S
            tan = bezier(b0, b1, b2, min(tt + 0.02, 1)) - bezier(b0, b1, b2, max(tt - 0.02, 0))
            ta = np.arctan2(tan[1], tan[0])
            sgn = 1 if k % 2 == 0 else -1
            leaves.append((p, ta + sgn * (0.75 + 0.35 * rng.random())))
        tipp = b2 * S
        tan = b2 - b1
        ta = np.arctan2(tan[1], tan[0])
        for j in range(3):
            leaves.append((tipp, ta + (j - 1) * 0.55 + rng.normal(0, 0.1)))
    order = rng.permutation(len(leaves))
    light = (0.45, -0.89)
    for k, i in enumerate(order):
        p, a = leaves[i]
        L = (0.13 + 0.05 * rng.random()) * S
        W = L * (0.31 + 0.06 * rng.random())
        # short petiole
        pet = p + np.array([np.cos(a), np.sin(a)]) * 0.022 * S
        cv.capsule(p, pet, 0.003 * S, 0.0025 * S, twig_col * 1.05)
        colour = LEAF_COL * (1 + rng.normal(0, 0.035)) * np.array([1 + rng.normal(0, 0.02), 1, 1 + rng.normal(0, 0.02)])
        depth = 0.86 + 0.14 * k / len(order)
        tilt = rng.normal(0, 0.18, 2)
        cv.leaf(rng, pet, a, L, W, colour, depth, light, teeth=int(rng.integers(10, 16)), vein_n=7,
                cup=0.18, tilt=tilt, ss=ss)
    return cv.resolve(ss)


def strokes_to_layer(S, res, kind, colour, perp, glob_t, fold, light=(0.45, -0.89), base_dark=0.8):
    """Shade z-buffered strokes: colour per stroke, along-stroke darkening,
    cross-section from s.  fold=True -> V-folded leaflet, else round."""
    idm = res["id"]
    filled = idm >= 0
    ids = np.where(filled, idm, 0)
    s = res["s"]
    gt = glob_t[ids, 0] + (glob_t[ids, 1] - glob_t[ids, 0]) * res["t"]
    pl = perp @ np.array(light)
    side = pl[ids]
    if fold:
        sh = 1 + 0.10 * np.sign(s) * np.sign(side) * smoothstep(0.0, 0.2, np.abs(s))
        sh *= 1 + 0.12 * (1 - smoothstep(0.0, 0.18, np.abs(s)))  # light midline
        k = 0.45 * np.sign(s)
    else:
        sh = 1 + 0.14 * s * side
        k = s * 0.9
    sh *= base_dark + (1 - base_dark) * smoothstep(0, 0.5, gt)
    col = colour[ids] * sh[..., None]
    nx = perp[ids, 0] * k
    ny = -perp[ids, 1] * k
    nz = np.sqrt(np.clip(1 - nx * nx - ny * ny, 0.1, 1))
    n = np.stack([nx, ny, nz], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return col, filled.astype(np.float32), n


def foliage_pine(seed=72, size=512, ss=3):
    """Slot 1: hanging pine tuft fixed along the top edge."""
    rng = np.random.default_rng(seed)
    S = size * ss
    P0, P1, W0, W1, Z0, Z1, C, GT = [], [], [], [], [], [], [], []
    n_tw = 6
    for i in range(n_tw):
        f = (i + 0.5) / n_tw
        x0 = (0.16 + 0.68 * f + rng.normal(0, 0.01)) * S
        ang = np.pi / 2 + (f - 0.5) * 0.9 + rng.normal(0, 0.05)
        length = (0.62 + 0.2 * rng.random()) * S * (1 - 0.25 * abs(f - 0.5))
        curve = rng.normal(0, 0.15)
        npts = 40
        pts = []
        p = np.array([x0, -0.02 * S])
        a = ang
        seg = length / npts
        for j in range(npts + 1):
            pts.append(p.copy())
            a += curve / npts
            a += (np.pi / 2 - a) * 0.012  # droop toward vertical
            p = p + seg * np.array([np.cos(a), np.sin(a)])
        pts = np.array(pts)
        zt = 0.3 + 0.1 * rng.random()
        tw_col = np.array([0.66, 0.64, 0.58])
        for j in range(npts):
            tt = j / npts
            P0.append(pts[j]); P1.append(pts[j + 1])
            W0.append((2.6 - 1.6 * tt) * ss * 0.5); W1.append((2.6 - 1.6 * (tt + 1 / npts)) * ss * 0.5)
            Z0.append(zt); Z1.append(zt); C.append(tw_col); GT.append((0.6, 0.6))
        # needles along the twig on both sides, pointing forward/outward
        nn = int(length / (1.6 * ss))
        for k in range(nn):
            tt = (k + rng.random()) / nn
            j = min(int(tt * npts), npts - 1)
            base = pts[j] + (pts[j + 1] - pts[j]) * (tt * npts - j)
            td = pts[j + 1] - pts[j]
            ta = np.arctan2(td[1], td[0])
            for sgn in (-1, 1):
                if rng.random() < 0.15:
                    continue
                spread = 0.45 + 0.4 * rng.random()
                na = ta + sgn * spread
                nl = (0.12 + 0.05 * rng.random()) * S * (0.55 + 0.45 * smoothstep(0, 0.2, tt)) * (1.0 - 0.35 * smoothstep(0.85, 1.0, tt))
                # slight curve: two segments
                mid = base + nl * 0.5 * np.array([np.cos(na), np.sin(na)])
                na2 = na + sgn * rng.normal(-0.12, 0.08) + (np.pi / 2 - na) * 0.12
                end = mid + nl * 0.5 * np.array([np.cos(na2), np.sin(na2)])
                front = rng.random() < 0.55
                zb = zt + (0.12 if front else -0.18) + rng.random() * 0.08
                c = LEAF_COL * np.array([0.98, 1.0, 1.0]) * (1.04 + rng.normal(0, 0.05)) * (1.0 if front else 0.86)
                wn = (1.3 + 0.5 * rng.random()) * ss * 0.5
                P0 += [base, mid]; P1 += [mid, end]
                W0 += [wn, wn * 0.85]; W1 += [wn * 0.85, wn * 0.15]
                Z0 += [zb, zb + 0.02]; Z1 += [zb + 0.02, zb + 0.03]
                C += [c, c]; GT += [(0.0, 0.5), (0.5, 1.0)]
    P0 = np.array(P0); P1 = np.array(P1)
    res = raster_strokes(S, S, P0, P1, np.array(W0), np.array(W1), np.clip(Z0, 0, 0.95), np.clip(Z1, 0, 0.95),
                         0.01, wrap=False)
    d = P1 - P0
    dl = np.maximum(np.hypot(d[:, 0], d[:, 1]), 1e-6)
    perp = np.stack([-d[:, 1] / dl, d[:, 0] / dl], 1)
    col, a, n = strokes_to_layer(S, res, None, np.array(C), perp, np.array(GT), fold=False, base_dark=0.85)
    a_s = downsample(a, ss)
    col = downsample(col * a[..., None], ss) / np.maximum(a_s[..., None], 1e-6)
    n = downsample(n * a[..., None], ss)
    n[..., 2] += 1 - a_s
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return col, a_s, n


def foliage_palm(seed=73, size=512, ss=3):
    """Slot 2: palm frond, base at the bottom, tip at the top."""
    rng = np.random.default_rng(seed)
    S = size * ss
    P0, P1, W0, W1, Z0, Z1, C, GT = [], [], [], [], [], [], [], []
    r0 = np.array([0.5, 1.0]) * S
    r1 = np.array([0.47, 0.5]) * S
    r2 = np.array([0.53, 0.02]) * S
    nr = 60
    rach = bezier(r0, r1, r2, np.linspace(0, 1, nr + 1))
    rc = np.array([0.74, 0.76, 0.66])
    for j in range(nr):
        tt = j / nr
        P0.append(rach[j]); P1.append(rach[j + 1])
        W0.append((5.5 - 4.0 * tt) * ss * 0.5); W1.append((5.5 - 4.0 * (tt + 1 / nr)) * ss * 0.5)
        Z0.append(0.6); Z1.append(0.6); C.append(rc); GT.append((0.7, 0.7))
    n_l = 44
    for k in range(n_l):
        tt = 0.06 + 0.92 * (k + 0.5) / n_l
        for sgn in (-1, 1):
            tq = tt + rng.normal(0, 0.004)
            base = bezier(r0, r1, r2, tq)
            tan = bezier(r0, r1, r2, tq + 0.01) - bezier(r0, r1, r2, tq - 0.01)
            ta = np.arctan2(tan[1], tan[0])  # pointing toward the tip (up)
            # leaflet length: longest near middle-base, short toward tip
            env = np.sin(np.pi * np.clip((tq - 0.02) / 1.0, 0, 1) ** 0.65) ** 0.9
            Ll = (0.10 + 0.36 * env) * S * (1 + rng.normal(0, 0.04))
            Ll *= 1 - 0.65 * smoothstep(0.75, 1.0, tq)
            Ll = max(Ll, 0.03 * S)
            # leave the rib angled forward then droop outward/down
            a0 = ta + sgn * (0.95 + 0.25 * tq) + rng.normal(0, 0.04)
            droop = 0.55 + 0.25 * rng.random()
            wmax = (0.020 + 0.012 * env) * S
            nseg = 6
            p = base.copy()
            a = a0
            zl = 0.3 + 0.25 * tq + rng.random() * 0.05 + (0.1 if sgn > 0 else 0.0)
            c = LEAF_COL * (1 + rng.normal(0, 0.035)) * np.array([1.0 + rng.normal(0, 0.015), 1, 1])
            for j in range(nseg):
                u0 = j / nseg
                u1 = (j + 1) / nseg
                wf = lambda u: wmax * (0.45 + 0.55 * np.sin(np.pi / 2 * min(u / 0.25, 1))) * (1 - u) ** 0.75 * 0.5
                q = p + Ll / nseg * np.array([np.cos(a), np.sin(a)])
                P0.append(p.copy()); P1.append(q.copy())
                W0.append(max(wf(u0), 0.4)); W1.append(max(wf(u1), 0.2))
                Z0.append(zl + 0.01 * u0); Z1.append(zl + 0.01 * u1)
                C.append(c); GT.append((u0, u1))
                p = q
                # rotate toward 'down' (pi/2) on the outer half
                dn = np.pi / 2 - a
                dn = (dn + np.pi) % (2 * np.pi) - np.pi
                a += dn * droop * 0.12 * (u1 ** 1.2)
    P0 = np.array(P0); P1 = np.array(P1)
    res = raster_strokes(S, S, P0, P1, np.array(W0), np.array(W1), np.clip(Z0, 0, 0.95), np.clip(Z1, 0, 0.95),
                         0.0, wrap=False)
    d = P1 - P0
    dl = np.maximum(np.hypot(d[:, 0], d[:, 1]), 1e-6)
    perp = np.stack([-d[:, 1] / dl, d[:, 0] / dl], 1)
    col, a, n = strokes_to_layer(S, res, None, np.array(C), perp, np.array(GT), fold=True, base_dark=0.88)
    a_s = downsample(a, ss)
    col = downsample(col * a[..., None], ss) / np.maximum(a_s[..., None], 1e-6)
    n = downsample(n * a[..., None], ss)
    n[..., 2] += 1 - a_s
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return col, a_s, n


def foliage_dense(seed=74, size=512, ss=3):
    """Slot 3: opaque tileable mass of small overlapping leaves."""
    rng = np.random.default_rng(seed)
    S = size * ss
    bgn = noise_fbm(rng, S, S, 4, 64, 1.0)
    bg = (0.42 + 0.04 * bgn)[..., None] * LEAF_COL[None, None, :] / LEAF_COL.mean()
    cv = Canvas(S, S, wrap=True)
    cv.col[:] = bg
    cv.a[:] = 1
    n = 1500
    light = (0.45, -0.89)
    clump = noise_fbm(rng, 64, 64, 2, 8, 1.2)
    for k in range(n):
        p = rng.random(2) * S
        f = k / n
        L = (0.075 + 0.04 * rng.random()) * S
        W = L * (0.30 + 0.06 * rng.random())
        a = rng.random() * 2 * np.pi
        cl = sample_wrap(clump, p[0] / S * 64, p[1] / S * 64)
        depth = (0.55 + 0.45 * f ** 0.8) * (1 + 0.13 * cl)
        colour = LEAF_COL * (1 + rng.normal(0, 0.04)) * np.array([1 + rng.normal(0, 0.02), 1, 1 + rng.normal(0, 0.02)])
        cv.leaf(rng, p - np.array([np.cos(a), np.sin(a)]) * L * 0.3, a, L, W, colour, depth, light,
                teeth=0, vein_n=5, cup=0.22, tilt=rng.normal(0, 0.25, 2), ss=ss)
    col, a, nrm = cv.resolve(ss)
    return col, np.ones_like(a), nrm


def gen_foliage():
    slots = [foliage_leaves(), foliage_pine(), foliage_palm(), foliage_dense()]
    cols, alphas, norms = [], [], []
    for i, (c, a, n) in enumerate(slots):
        if i < 3:
            c = bleed_rgb(c, a, 16, fill=(c[a > 0.5].mean(0)))
        cols.append(c)
        alphas.append(a)
        norms.append(n)
    col = np.concatenate(cols, 1)
    a = np.concatenate(alphas, 1)
    n = np.concatenate(norms, 1)
    return col, a, n


# --------------------------------------------------------------------------
# clouds
# --------------------------------------------------------------------------

def gen_clouds(seed=81, W=2048, H=512):
    rng = np.random.default_rng(seed)
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32) + 0.5
    col = np.zeros((H, W, 3), np.float32)
    alpha = np.zeros((H, W), np.float32)
    fluff = noise_fbm(rng, H, W, 6, 90, 0.9, ax=0.25)
    L = np.array([0.25, 0.80, 0.55])  # +Y up (matches nn below)
    L /= np.linalg.norm(L)
    under = np.array([0.66, 0.72, 0.84])
    clouds = []
    # elevation of the cloud base (degrees above horizon), many low, few high
    for i in range(34):
        e = 0.8 + 19 * rng.random() ** 2.2
        clouds.append(e)
    clouds.sort()
    for e in clouds:
        base_y = H * (1 - e / 40.0)
        scale = 0.55 + e / 11.0           # nearer (higher) clouds look bigger
        width = (70 + 90 * rng.random()) * scale
        squash = 0.55 + 0.45 * smoothstep(0, 14, e)  # flatter near the horizon
        cx = rng.random() * W
        puffs = []
        nb = int(3 + width / 28)
        for k in range(nb):
            px = cx + (k / (nb - 1) - 0.5) * width * 0.85 + rng.normal(0, 4)
            r = width * (0.13 + 0.07 * rng.random()) * (1 - 0.45 * abs(k / (nb - 1) - 0.5))
            puffs.append((px, base_y - r * 0.55 * squash, r))
        # upper tiers: fewer, bigger puffs toward the middle
        tiers = 1 + int(rng.random() * 2.2 + 0.4)
        for tier in range(tiers):
            nt = max(1, int(nb * (0.55 - 0.18 * tier)))
            for k in range(nt):
                px = cx + (rng.random() - 0.5) * width * (0.55 - 0.15 * tier)
                r = width * (0.17 + 0.08 * rng.random()) * (1 - 0.2 * tier)
                py = base_y - (width * (0.20 + 0.16 * tier) + r * 0.4) * squash
                puffs.append((px, py, r))
        rmax = max(p[2] for p in puffs)
        x0 = cx - width * 0.6 - rmax
        x1 = cx + width * 0.6 + rmax
        y0 = min(p[1] - p[2] * squash for p in puffs) - 4
        y1 = base_y + 4
        yi = np.arange(max(0, int(y0)), min(H, int(y1) + 1))
        if yi.size == 0:
            continue
        xi = np.arange(int(np.floor(x0)), int(np.ceil(x1)) + 1)
        X, Y = np.meshgrid(xi + 0.5, yi + 0.5)
        # union of sphere height fields: crisp puffy outline
        best = np.full(X.shape, -1e9, np.float64)
        for (px, py, r) in puffs:
            dx = X - px
            dy = (Y - py) / squash
            dd = np.sqrt(dx * dx + dy * dy)
            z = np.where(dd < r, np.sqrt(np.clip(r * r - dd * dd, 0, None)), -(dd - r) * 2.0)
            best = np.maximum(best, z)
        field = best
        xw = xi % W
        fl = fluff[np.ix_(yi, xw)]
        edge = 1.2 + 0.012 * width
        cov = smoothstep(-edge, edge, field + fl * (0.6 + 0.008 * width))
        bfade = 2.0 + 5.0 * squash
        cov *= smoothstep(base_y + 1.0, base_y - bfade, Y)   # flat-ish base
        # shading normals from a softened copy of the field (no seams)
        fz = np.maximum(field, -4)
        fz = ndimage.gaussian_filter(fz, 1.5 + 0.03 * width)
        gy, gx = np.gradient(fz)
        nn = np.stack([-gx, gy * squash, np.ones_like(gx) * 0.8], -1)
        nn /= np.linalg.norm(nn, axis=-1, keepdims=True)
        dif = np.clip(nn @ L, 0, 1)
        hgt = smoothstep(base_y, base_y - width * 0.5 * squash, Y)
        lit = np.clip(0.05 + 0.75 * dif + 0.40 * hgt, 0, 1) ** 1.2
        c = under + (1.0 - under) * lit[..., None]
        far = smoothstep(0, 6, e)
        cov = cov * (0.78 + 0.22 * far)
        sl = np.ix_(yi, xw)
        a_old = alpha[sl]
        c_old = col[sl]
        a_new = cov + a_old * (1 - cov)
        col[sl] = (c * cov[..., None] + c_old * (a_old * (1 - cov))[..., None]) / np.maximum(a_new[..., None], 1e-6)
        alpha[sl] = a_new
    # fade toward the very horizon (haze) and colour-bleed into clear sky
    alpha *= smoothstep(H + 2, H - 10, ys)
    col = bleed_rgb(col, alpha, 16, fill=np.array([0.86, 0.89, 0.94]))
    return col, alpha


# --------------------------------------------------------------------------
# contact sheet / main
# --------------------------------------------------------------------------

def make_sheet(entries, path, cell=384, cols=5):
    from PIL import ImageDraw
    rows = (len(entries) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell, rows * (cell + 18)), (30, 30, 34))
    dr = ImageDraw.Draw(sheet)
    for i, (label, img) in enumerate(entries):
        im = Image.open(img) if isinstance(img, str) else img
        if im.mode == "RGBA":
            bg = Image.new("RGBA", im.size, (110, 160, 215, 255))
            if "foliage" in label:
                bg = Image.new("RGBA", im.size, (70, 110, 80, 255))
            im = Image.alpha_composite(bg, im)
        im = im.convert("RGB")
        w, h = im.size
        t = Image.new("RGB", (w * 2, h * 2))
        for yy in range(2):
            for xx in range(2):
                t.paste(im, (xx * w, yy * h))
        sc = cell / max(t.size)
        t = t.resize((max(1, int(t.size[0] * sc)), max(1, int(t.size[1] * sc))), Image.LANCZOS)
        cx = (i % cols) * cell
        cy = (i // cols) * (cell + 18)
        sheet.paste(t, (cx, cy + 18))
        dr.text((cx + 4, cy + 3), label, fill=(230, 230, 230))
    sheet.save(path)


def report_stats(name, alb):
    m = alb.reshape(-1, 3).mean(0)
    s = (alb @ LUMA).std()
    print(f"  {name}: mean RGB = {m[0]:.3f} {m[1]:.3f} {m[2]:.3f}  luma std = {s:.3f}")
    return m, s


def main(argv):
    os.makedirs(OUT, exist_ok=True)
    want = set(argv[1:])
    run = lambda k: not want or k in want
    stats = {}
    t_all = time.time()

    def detail(name, alb, nrm, q=88):
        a8 = to_u8(alb)
        stats[name] = report_stats(name, a8 / 255.0)
        save_webp(a8, name, q)
        save_webp(normal_to_rgb(nrm), name + "_n", NORMAL_Q)

    if run("grass_fairway"):
        t = time.time()
        alb, nrm, _ = gen_grass("grass_fairway", 1024, 11, 90_000, (7, 16), (2.2, 3.6), -np.pi / 2, 0.45,
                                0.11, 3.0, patch_amp=0.04)
        detail("grass_fairway", alb, nrm)
        print(f"grass_fairway {time.time() - t:.1f}s")
    if run("grass_green"):
        t = time.time()
        alb, nrm, _ = gen_grass("grass_green", 1024, 12, 230_000, (3.5, 7.5), (1.4, 2.2), -np.pi / 2, 0.7,
                                0.06, 1.8, patch_amp=0.03, gap_dark=0.45, tip_warm=0.06)
        detail("grass_green", alb, nrm)
        print(f"grass_green {time.time() - t:.1f}s")
    if run("grass_rough"):
        t = time.time()
        alb, nrm, _ = gen_grass("grass_rough", 1024, 13, 66_000, (16, 38), (3.0, 5.2), -np.pi / 2, 1.0,
                                0.14, 4.5, clumps=(170, 30, 0.5), patch_amp=0.06, gap_dark=0.30)
        detail("grass_rough", alb, nrm)
        print(f"grass_rough {time.time() - t:.1f}s")
    if run("sand"):
        t = time.time()
        alb, nrm = gen_sand()
        detail("sand", alb, nrm)
        print(f"sand {time.time() - t:.1f}s")
    if run("soil"):
        t = time.time()
        alb, nrm = gen_soil()
        detail("soil", alb, nrm)
        print(f"soil {time.time() - t:.1f}s")
    if run("macro"):
        m = gen_macro()
        g8 = to_u8(m)
        print(f"  macro: mean = {g8.mean() / 255:.3f}  std = {(g8 / 255).std():.3f}")
        save_webp(np.repeat(g8[..., None], 3, -1), "macro", lossless=True)
    if run("bark"):
        t = time.time()
        col, nrm = gen_bark()
        save_webp(to_u8(col), "bark")
        save_webp(normal_to_rgb(nrm), "bark_n", NORMAL_Q)
        print(f"bark {time.time() - t:.1f}s")
    if run("foliage"):
        t = time.time()
        col, a, n = gen_foliage()
        rgba = np.concatenate([to_u8(col), to_u8(a)[..., None]], -1)
        save_png(rgba, "foliage")
        save_png(normal_to_rgb(n), "foliage_n")
        op = a > 0.99
        lum = col[op] @ LUMA
        print(f"  foliage opaque luma: mean {lum.mean():.3f}  p5 {np.percentile(lum, 5):.3f}  p95 {np.percentile(lum, 95):.3f}")
        print(f"foliage {time.time() - t:.1f}s")
    if run("clouds"):
        t = time.time()
        col, a = gen_clouds()
        rgba = np.concatenate([to_u8(col), to_u8(a)[..., None]], -1)
        save_png(rgba, "clouds")
        print(f"clouds {time.time() - t:.1f}s")
    if run("water"):
        t = time.time()
        save_webp(normal_to_rgb(gen_water()), "water_n", 92)
        print(f"water {time.time() - t:.1f}s")
    print(f"total {time.time() - t_all:.1f}s")
    return stats


if __name__ == "__main__":
    main(sys.argv)
