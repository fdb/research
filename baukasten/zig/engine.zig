// baukasten engine — procedural texture + mesh synthesis, compiled to WASM.
//
// The JS side serializes an op stack (werkkzeug style) into a flat f32
// command buffer: [opcode, nparams, params...] repeated. Generators push a
// buffer onto an internal value stack, filters pop one and push the result,
// combiners pop two. The final top-of-stack is the op stack's output.
//
// Everything is deterministic: all randomness derives from integer hashes of
// lattice coordinates + a seed parameter, so the same project always renders
// the same artefact.

const std = @import("std");
const math = std.math;

// ---------------------------------------------------------------------------
// Arena allocator on raw wasm memory. Reset at the start of every eval call.
// ---------------------------------------------------------------------------

const PAGE = 65536;
var heap_start: usize = 0;
var heap_ptr: usize = 0;

fn arenaInit() void {
    if (heap_start == 0) heap_start = @wasmMemorySize(0) * PAGE;
    heap_ptr = heap_start;
}

fn arenaAlloc(comptime T: type, count: usize) [*]T {
    const bytes = count * @sizeOf(T);
    const aligned = (heap_ptr + 15) & ~@as(usize, 15);
    const end = aligned + bytes;
    const have = @wasmMemorySize(0) * PAGE;
    if (end > have) {
        const need_pages = (end - have + PAGE - 1) / PAGE;
        _ = @wasmMemoryGrow(0, need_pages);
    }
    heap_ptr = end;
    return @ptrFromInt(aligned);
}

// Command buffer, written directly by JS.
var cmd_buf: [16384]f32 = undefined;

export fn cmd_ptr() u32 {
    return @intFromPtr(&cmd_buf);
}

// ---------------------------------------------------------------------------
// Hashing / randomness
// ---------------------------------------------------------------------------

fn hashU32(x: u32) u32 {
    var h = x;
    h ^= h >> 16;
    h *%= 0x7feb352d;
    h ^= h >> 15;
    h *%= 0x846ca68b;
    h ^= h >> 16;
    return h;
}

fn hash2(ix: i32, iy: i32, seed: u32) f32 {
    const h = hashU32(hashU32(@as(u32, @bitCast(ix)) +% seed *% 0x9e3779b9) +% @as(u32, @bitCast(iy)));
    return @as(f32, @floatFromInt(h & 0xffffff)) / 16777215.0;
}

fn hash3(ix: i32, iy: i32, iz: i32, seed: u32) f32 {
    const h = hashU32(hashU32(hashU32(@as(u32, @bitCast(ix)) +% seed *% 0x9e3779b9) +% @as(u32, @bitCast(iy))) +% @as(u32, @bitCast(iz)));
    return @as(f32, @floatFromInt(h & 0xffffff)) / 16777215.0;
}

fn smooth(t: f32) f32 {
    return t * t * (3.0 - 2.0 * t);
}

fn wrapI(i: i32, period: i32) i32 {
    return @mod(i, period);
}

// Tileable 2D value noise. `period` is the lattice size; sampling wraps so
// textures tile seamlessly. fbm doubles the period per octave (lacunarity is
// fixed at 2 to preserve tiling).
fn vnoise2(x: f32, y: f32, period: i32, seed: u32) f32 {
    const fx = @floor(x);
    const fy = @floor(y);
    const ix: i32 = @intFromFloat(fx);
    const iy: i32 = @intFromFloat(fy);
    const tx = smooth(x - fx);
    const ty = smooth(y - fy);
    const x0 = wrapI(ix, period);
    const x1 = wrapI(ix + 1, period);
    const y0 = wrapI(iy, period);
    const y1 = wrapI(iy + 1, period);
    const a = hash2(x0, y0, seed);
    const b = hash2(x1, y0, seed);
    const c = hash2(x0, y1, seed);
    const d = hash2(x1, y1, seed);
    return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

// noise type: 0 = fbm, 1 = ridged, 2 = turbulence
fn fbm2(u: f32, v: f32, scale: f32, octaves: u32, gain: f32, seed: u32, ntype: u32) f32 {
    var sum: f32 = 0.0;
    var amp: f32 = 1.0;
    var norm: f32 = 0.0;
    var period: i32 = @intFromFloat(@max(1.0, @round(scale)));
    var i: u32 = 0;
    while (i < octaves) : (i += 1) {
        const p: f32 = @floatFromInt(period);
        var n = vnoise2(u * p, v * p, period, seed +% i *% 131);
        if (ntype == 1) {
            n = 1.0 - @abs(n * 2.0 - 1.0);
            n = n * n;
        } else if (ntype == 2) {
            n = @abs(n * 2.0 - 1.0);
        }
        sum += n * amp;
        norm += amp;
        amp *= gain;
        period *= 2;
    }
    return if (norm > 0.0) sum / norm else 0.0;
}

// 3D value noise fbm, for mesh displacement (not tileable, doesn't need to be).
fn vnoise3(x: f32, y: f32, z: f32, seed: u32) f32 {
    const fx = @floor(x);
    const fy = @floor(y);
    const fz = @floor(z);
    const ix: i32 = @intFromFloat(fx);
    const iy: i32 = @intFromFloat(fy);
    const iz: i32 = @intFromFloat(fz);
    const tx = smooth(x - fx);
    const ty = smooth(y - fy);
    const tz = smooth(z - fz);
    const c000 = hash3(ix, iy, iz, seed);
    const c100 = hash3(ix + 1, iy, iz, seed);
    const c010 = hash3(ix, iy + 1, iz, seed);
    const c110 = hash3(ix + 1, iy + 1, iz, seed);
    const c001 = hash3(ix, iy, iz + 1, seed);
    const c101 = hash3(ix + 1, iy, iz + 1, seed);
    const c011 = hash3(ix, iy + 1, iz + 1, seed);
    const c111 = hash3(ix + 1, iy + 1, iz + 1, seed);
    const a = lerp(lerp(c000, c100, tx), lerp(c010, c110, tx), ty);
    const b = lerp(lerp(c001, c101, tx), lerp(c011, c111, tx), ty);
    return lerp(a, b, tz);
}

fn fbm3(x: f32, y: f32, z: f32, octaves: u32, seed: u32) f32 {
    var sum: f32 = 0.0;
    var amp: f32 = 1.0;
    var norm: f32 = 0.0;
    var freq: f32 = 1.0;
    var i: u32 = 0;
    while (i < octaves) : (i += 1) {
        sum += vnoise3(x * freq, y * freq, z * freq, seed +% i *% 197) * amp;
        norm += amp;
        amp *= 0.5;
        freq *= 2.0;
    }
    return if (norm > 0.0) sum / norm else 0.0;
}

fn lerp(a: f32, b: f32, t: f32) f32 {
    return a + (b - a) * t;
}

fn clamp01(x: f32) f32 {
    return @min(1.0, @max(0.0, x));
}

fn fract(x: f32) f32 {
    return x - @floor(x);
}

fn smoothstep(e0: f32, e1: f32, x: f32) f32 {
    if (e0 == e1) return if (x < e0) 0.0 else 1.0;
    return smooth(clamp01((x - e0) / (e1 - e0)));
}

// ---------------------------------------------------------------------------
// Texture evaluation
// ---------------------------------------------------------------------------
// Buffers are interleaved RGBA f32, size*size pixels, values nominally 0..1.

const TEX_STACK_MAX = 8;

const TexCtx = struct {
    size: u32,
    stack: [TEX_STACK_MAX][*]f32,
    depth: u32,

    fn push(self: *TexCtx) [*]f32 {
        const buf = arenaAlloc(f32, self.size * self.size * 4);
        if (self.depth < TEX_STACK_MAX) {
            self.stack[self.depth] = buf;
            self.depth += 1;
        }
        return buf;
    }

    fn pop(self: *TexCtx) [*]f32 {
        if (self.depth == 0) return self.push(); // degenerate; keeps us safe
        self.depth -= 1;
        return self.stack[self.depth];
    }
};

fn texPixels(ctx: *TexCtx) u32 {
    return ctx.size * ctx.size;
}

// Bilinear sample with wrapping, uv in 0..1.
fn texSample(src: [*]f32, size: u32, u: f32, v: f32, out: *[4]f32) void {
    const s: f32 = @floatFromInt(size);
    const x = fract(u) * s - 0.5;
    const y = fract(v) * s - 0.5;
    const fx = @floor(x);
    const fy = @floor(y);
    const tx = x - fx;
    const ty = y - fy;
    const n: i32 = @intCast(size);
    const x0 = @mod(@as(i32, @intFromFloat(fx)), n);
    const x1 = @mod(x0 + 1, n);
    const y0 = @mod(@as(i32, @intFromFloat(fy)), n);
    const y1 = @mod(y0 + 1, n);
    const idx00: u32 = (@as(u32, @intCast(y0)) * size + @as(u32, @intCast(x0))) * 4;
    const idx10: u32 = (@as(u32, @intCast(y0)) * size + @as(u32, @intCast(x1))) * 4;
    const idx01: u32 = (@as(u32, @intCast(y1)) * size + @as(u32, @intCast(x0))) * 4;
    const idx11: u32 = (@as(u32, @intCast(y1)) * size + @as(u32, @intCast(x1))) * 4;
    var c: u32 = 0;
    while (c < 4) : (c += 1) {
        const a = lerp(src[idx00 + c], src[idx10 + c], tx);
        const b = lerp(src[idx01 + c], src[idx11 + c], tx);
        out[c] = lerp(a, b, ty);
    }
}

fn opSolid(ctx: *TexCtx, p: [*]const f32) void {
    const dst = ctx.push();
    var i: u32 = 0;
    const n = texPixels(ctx);
    while (i < n) : (i += 1) {
        dst[i * 4 + 0] = p[0];
        dst[i * 4 + 1] = p[1];
        dst[i * 4 + 2] = p[2];
        dst[i * 4 + 3] = p[3];
    }
}

fn opNoise(ctx: *TexCtx, p: [*]const f32) void {
    const scale = p[0];
    const octaves: u32 = @intFromFloat(@max(1.0, p[1]));
    const gain = p[2];
    const seed: u32 = @intFromFloat(@max(0.0, p[3]));
    const ntype: u32 = @intFromFloat(@max(0.0, p[4]));
    const dst = ctx.push();
    const size = ctx.size;
    const inv: f32 = 1.0 / @as(f32, @floatFromInt(size));
    var y: u32 = 0;
    var i: u32 = 0;
    while (y < size) : (y += 1) {
        const v = (@as(f32, @floatFromInt(y)) + 0.5) * inv;
        var x: u32 = 0;
        while (x < size) : (x += 1) {
            const u = (@as(f32, @floatFromInt(x)) + 0.5) * inv;
            const n = fbm2(u, v, scale, octaves, gain, seed, ntype);
            dst[i + 0] = n;
            dst[i + 1] = n;
            dst[i + 2] = n;
            dst[i + 3] = 1.0;
            i += 4;
        }
    }
}

// type: 0 circle, 1 ring, 2 box, 3 linear gradient, 4 radial gradient
fn opShape(ctx: *TexCtx, p: [*]const f32) void {
    const stype: u32 = @intFromFloat(@max(0.0, p[0]));
    const cx = p[1];
    const cy = p[2];
    const w = @max(0.0001, p[3]);
    const h = @max(0.0001, p[4]);
    const feather = @max(0.0005, p[5]);
    const rot = p[6];
    const cr = math.cos(-rot);
    const sr = math.sin(-rot);
    const dst = ctx.push();
    const size = ctx.size;
    const inv: f32 = 1.0 / @as(f32, @floatFromInt(size));
    var y: u32 = 0;
    var i: u32 = 0;
    while (y < size) : (y += 1) {
        const v = (@as(f32, @floatFromInt(y)) + 0.5) * inv;
        var x: u32 = 0;
        while (x < size) : (x += 1) {
            const u = (@as(f32, @floatFromInt(x)) + 0.5) * inv;
            var dx = u - cx;
            var dy = v - cy;
            const rx = dx * cr - dy * sr;
            const ry = dx * sr + dy * cr;
            dx = rx;
            dy = ry;
            var val: f32 = 0.0;
            switch (stype) {
                0 => { // circle
                    const d = @sqrt((dx / w) * (dx / w) + (dy / h) * (dy / h));
                    val = 1.0 - smoothstep(1.0 - feather, 1.0, d);
                },
                1 => { // ring: w = radius, h = half thickness
                    const d = @sqrt(dx * dx + dy * dy);
                    val = 1.0 - smoothstep(h - feather, h, @abs(d - w));
                },
                2 => { // box: w,h half extents
                    const bx = @abs(dx) - w;
                    const by = @abs(dy) - h;
                    const d = @max(bx, by);
                    val = 1.0 - smoothstep(-feather, 0.0, d);
                },
                3 => { // linear gradient along rotated x, width w
                    val = clamp01(0.5 + dx / w);
                },
                else => { // radial gradient
                    const d = @sqrt((dx / w) * (dx / w) + (dy / h) * (dy / h));
                    val = clamp01(1.0 - d);
                },
            }
            dst[i + 0] = val;
            dst[i + 1] = val;
            dst[i + 2] = val;
            dst[i + 3] = 1.0;
            i += 4;
        }
    }
}

// Worley/Voronoi shared machinery. Returns F1, F2 and the feature cell hash.
const CellResult = struct { f1: f32, f2: f32, id: f32 };

fn cellNoise(u: f32, v: f32, scale: f32, jitter: f32, seed: u32) CellResult {
    const period: i32 = @intFromFloat(@max(1.0, @round(scale)));
    const pf: f32 = @floatFromInt(period);
    const x = u * pf;
    const y = v * pf;
    const ix: i32 = @intFromFloat(@floor(x));
    const iy: i32 = @intFromFloat(@floor(y));
    var f1: f32 = 1e9;
    var f2: f32 = 1e9;
    var id: f32 = 0.0;
    var oy: i32 = -1;
    while (oy <= 1) : (oy += 1) {
        var ox: i32 = -1;
        while (ox <= 1) : (ox += 1) {
            const cxw = wrapI(ix + ox, period);
            const cyw = wrapI(iy + oy, period);
            const jx = hash2(cxw, cyw, seed +% 11) * jitter + (1.0 - jitter) * 0.5;
            const jy = hash2(cxw, cyw, seed +% 47) * jitter + (1.0 - jitter) * 0.5;
            const px = @as(f32, @floatFromInt(ix + ox)) + jx;
            const py = @as(f32, @floatFromInt(iy + oy)) + jy;
            const dx = px - x;
            const dy = py - y;
            const d = @sqrt(dx * dx + dy * dy);
            if (d < f1) {
                f2 = f1;
                f1 = d;
                id = hash2(cxw, cyw, seed +% 101);
            } else if (d < f2) {
                f2 = d;
            }
        }
    }
    return .{ .f1 = f1, .f2 = f2, .id = id };
}

fn opCells(ctx: *TexCtx, p: [*]const f32) void {
    const scale = p[0];
    const seed: u32 = @intFromFloat(@max(0.0, p[1]));
    const jitter = clamp01(p[2]);
    const dst = ctx.push();
    const size = ctx.size;
    const inv: f32 = 1.0 / @as(f32, @floatFromInt(size));
    var y: u32 = 0;
    var i: u32 = 0;
    while (y < size) : (y += 1) {
        const v = (@as(f32, @floatFromInt(y)) + 0.5) * inv;
        var x: u32 = 0;
        while (x < size) : (x += 1) {
            const u = (@as(f32, @floatFromInt(x)) + 0.5) * inv;
            const c = cellNoise(u, v, scale, jitter, seed);
            const n = clamp01(c.f1);
            dst[i + 0] = n;
            dst[i + 1] = n;
            dst[i + 2] = n;
            dst[i + 3] = 1.0;
            i += 4;
        }
    }
}

// mode: 0 = edges (F2-F1), 1 = flat random shade per cell, 2 = shaded cells
fn opVoronoi(ctx: *TexCtx, p: [*]const f32) void {
    const scale = p[0];
    const seed: u32 = @intFromFloat(@max(0.0, p[1]));
    const jitter = clamp01(p[2]);
    const mode: u32 = @intFromFloat(@max(0.0, p[3]));
    const dst = ctx.push();
    const size = ctx.size;
    const inv: f32 = 1.0 / @as(f32, @floatFromInt(size));
    var y: u32 = 0;
    var i: u32 = 0;
    while (y < size) : (y += 1) {
        const v = (@as(f32, @floatFromInt(y)) + 0.5) * inv;
        var x: u32 = 0;
        while (x < size) : (x += 1) {
            const u = (@as(f32, @floatFromInt(x)) + 0.5) * inv;
            const c = cellNoise(u, v, scale, jitter, seed);
            const n = switch (mode) {
                0 => clamp01((c.f2 - c.f1) * 2.0),
                1 => c.id,
                else => clamp01(c.id * (1.0 - c.f1 * 0.7)),
            };
            dst[i + 0] = n;
            dst[i + 1] = n;
            dst[i + 2] = n;
            dst[i + 3] = 1.0;
            i += 4;
        }
    }
}

fn opBricks(ctx: *TexCtx, p: [*]const f32) void {
    const nx = @max(1.0, p[0]);
    const ny = @max(1.0, p[1]);
    const mortar = @max(0.001, p[2]); // mortar half-width, in brick-uv units
    const bevel = @max(0.0005, p[3]); // edge softness
    const shift = p[4]; // row offset (0.5 = classic running bond)
    const seed: u32 = @intFromFloat(@max(0.0, p[5]));
    const dst = ctx.push();
    const size = ctx.size;
    const inv: f32 = 1.0 / @as(f32, @floatFromInt(size));
    var y: u32 = 0;
    var i: u32 = 0;
    while (y < size) : (y += 1) {
        const v = (@as(f32, @floatFromInt(y)) + 0.5) * inv;
        var x: u32 = 0;
        while (x < size) : (x += 1) {
            const u = (@as(f32, @floatFromInt(x)) + 0.5) * inv;
            const row = @floor(v * ny);
            const rowi: i32 = @intFromFloat(row);
            const uu = u * nx + row * shift;
            const col = @floor(uu);
            const coli: i32 = @intFromFloat(uu);
            _ = coli;
            const bx = uu - col; // 0..1 inside brick
            const by = v * ny - row;
            // distance to brick border, in brick-uv units
            const ex = @min(bx, 1.0 - bx);
            const ey = @min(by, 1.0 - by);
            const e = @min(ex, ey);
            const mask = smoothstep(mortar, mortar + bevel, e);
            // wrap the column for seamless tiling (row shift breaks exact
            // integer wrap, so hash on the shifted-space cell)
            const ci: i32 = @intFromFloat(@floor(@mod(uu, nx)));
            const shade = 0.55 + 0.45 * hash2(ci, rowi, seed);
            const val = lerp(0.12, shade, mask);
            dst[i + 0] = val;
            dst[i + 1] = val;
            dst[i + 2] = val;
            dst[i + 3] = 1.0;
            i += 4;
        }
    }
}

// iq cosine palette: color(t) = a + b*cos(2π(c*t + d)), applied to luminance.
fn opColorize(ctx: *TexCtx, p: [*]const f32) void {
    const src = ctx.pop();
    const dst = ctx.push();
    const n = texPixels(ctx);
    var i: u32 = 0;
    while (i < n) : (i += 1) {
        const r = src[i * 4 + 0];
        const g = src[i * 4 + 1];
        const b = src[i * 4 + 2];
        const t = r * 0.299 + g * 0.587 + b * 0.114;
        var c: u32 = 0;
        while (c < 3) : (c += 1) {
            const tau: f32 = 6.28318530718;
            dst[i * 4 + c] = clamp01(p[c] + p[3 + c] * math.cos(tau * (p[6 + c] * t + p[9 + c])));
        }
        dst[i * 4 + 3] = src[i * 4 + 3];
    }
}

fn opAdjust(ctx: *TexCtx, p: [*]const f32) void {
    const brightness = p[0];
    const contrast = p[1];
    const gamma = @max(0.01, p[2]);
    const src = ctx.pop();
    const dst = ctx.push();
    const n = texPixels(ctx);
    var i: u32 = 0;
    while (i < n) : (i += 1) {
        var c: u32 = 0;
        while (c < 3) : (c += 1) {
            var v = src[i * 4 + c];
            v = (v - 0.5) * contrast + 0.5 + brightness;
            v = math.pow(f32, clamp01(v), 1.0 / gamma);
            dst[i * 4 + c] = v;
        }
        dst[i * 4 + 3] = src[i * 4 + 3];
    }
}

fn opInvert(ctx: *TexCtx, _: [*]const f32) void {
    const src = ctx.pop();
    const dst = ctx.push();
    const n = texPixels(ctx);
    var i: u32 = 0;
    while (i < n) : (i += 1) {
        dst[i * 4 + 0] = 1.0 - src[i * 4 + 0];
        dst[i * 4 + 1] = 1.0 - src[i * 4 + 1];
        dst[i * 4 + 2] = 1.0 - src[i * 4 + 2];
        dst[i * 4 + 3] = src[i * 4 + 3];
    }
}

fn opTransform(ctx: *TexCtx, p: [*]const f32) void {
    const sx = if (p[0] == 0.0) 1.0 else p[0];
    const sy = if (p[1] == 0.0) 1.0 else p[1];
    const rot = p[2];
    const ox = p[3];
    const oy = p[4];
    const cr = math.cos(rot);
    const sr = math.sin(rot);
    const src = ctx.pop();
    const dst = ctx.push();
    const size = ctx.size;
    const inv: f32 = 1.0 / @as(f32, @floatFromInt(size));
    var y: u32 = 0;
    var i: u32 = 0;
    while (y < size) : (y += 1) {
        const v = (@as(f32, @floatFromInt(y)) + 0.5) * inv - 0.5;
        var x: u32 = 0;
        while (x < size) : (x += 1) {
            const u = (@as(f32, @floatFromInt(x)) + 0.5) * inv - 0.5;
            const ru = (u * cr - v * sr) * sx + 0.5 - ox;
            const rv = (u * sr + v * cr) * sy + 0.5 - oy;
            var px: [4]f32 = undefined;
            texSample(src, size, ru, rv, &px);
            dst[i + 0] = px[0];
            dst[i + 1] = px[1];
            dst[i + 2] = px[2];
            dst[i + 3] = px[3];
            i += 4;
        }
    }
}

// Separable wrapping box blur; `passes` iterations approximate a gaussian.
fn opBlur(ctx: *TexCtx, p: [*]const f32) void {
    const radius: i32 = @intFromFloat(@max(0.0, @min(64.0, p[0])));
    const passes: u32 = @intFromFloat(@max(1.0, @min(4.0, p[1])));
    const src = ctx.pop();
    if (radius == 0) {
        const dst = ctx.push();
        const n = texPixels(ctx) * 4;
        var i: u32 = 0;
        while (i < n) : (i += 1) dst[i] = src[i];
        return;
    }
    const size = ctx.size;
    const n: i32 = @intCast(size);
    const tmp = arenaAlloc(f32, size * size * 4);
    var cur = src;
    var pass: u32 = 0;
    const dst = ctx.push();
    const norm: f32 = 1.0 / @as(f32, @floatFromInt(radius * 2 + 1));
    while (pass < passes) : (pass += 1) {
        // horizontal: cur -> tmp
        var y: i32 = 0;
        while (y < n) : (y += 1) {
            var x: i32 = 0;
            while (x < n) : (x += 1) {
                var acc = [4]f32{ 0, 0, 0, 0 };
                var k: i32 = -radius;
                while (k <= radius) : (k += 1) {
                    const xx = @mod(x + k, n);
                    const idx: u32 = (@as(u32, @intCast(y)) * size + @as(u32, @intCast(xx))) * 4;
                    acc[0] += cur[idx + 0];
                    acc[1] += cur[idx + 1];
                    acc[2] += cur[idx + 2];
                    acc[3] += cur[idx + 3];
                }
                const o: u32 = (@as(u32, @intCast(y)) * size + @as(u32, @intCast(x))) * 4;
                tmp[o + 0] = acc[0] * norm;
                tmp[o + 1] = acc[1] * norm;
                tmp[o + 2] = acc[2] * norm;
                tmp[o + 3] = acc[3] * norm;
            }
        }
        // vertical: tmp -> dst
        var x2: i32 = 0;
        while (x2 < n) : (x2 += 1) {
            var y2: i32 = 0;
            while (y2 < n) : (y2 += 1) {
                var acc = [4]f32{ 0, 0, 0, 0 };
                var k: i32 = -radius;
                while (k <= radius) : (k += 1) {
                    const yy = @mod(y2 + k, n);
                    const idx: u32 = (@as(u32, @intCast(yy)) * size + @as(u32, @intCast(x2))) * 4;
                    acc[0] += tmp[idx + 0];
                    acc[1] += tmp[idx + 1];
                    acc[2] += tmp[idx + 2];
                    acc[3] += tmp[idx + 3];
                }
                const o: u32 = (@as(u32, @intCast(y2)) * size + @as(u32, @intCast(x2))) * 4;
                dst[o + 0] = acc[0] * norm;
                dst[o + 1] = acc[1] * norm;
                dst[o + 2] = acc[2] * norm;
                dst[o + 3] = acc[3] * norm;
            }
        }
        cur = dst;
    }
}

// Domain-warp the input by internal fbm.
fn opDistort(ctx: *TexCtx, p: [*]const f32) void {
    const amount = p[0];
    const scale = p[1];
    const seed: u32 = @intFromFloat(@max(0.0, p[2]));
    const src = ctx.pop();
    const dst = ctx.push();
    const size = ctx.size;
    const inv: f32 = 1.0 / @as(f32, @floatFromInt(size));
    var y: u32 = 0;
    var i: u32 = 0;
    while (y < size) : (y += 1) {
        const v = (@as(f32, @floatFromInt(y)) + 0.5) * inv;
        var x: u32 = 0;
        while (x < size) : (x += 1) {
            const u = (@as(f32, @floatFromInt(x)) + 0.5) * inv;
            const wx = fbm2(u, v, scale, 3, 0.5, seed, 0) - 0.5;
            const wy = fbm2(u, v, scale, 3, 0.5, seed +% 7919, 0) - 0.5;
            var px: [4]f32 = undefined;
            texSample(src, size, u + wx * amount, v + wy * amount, &px);
            dst[i + 0] = px[0];
            dst[i + 1] = px[1];
            dst[i + 2] = px[2];
            dst[i + 3] = px[3];
            i += 4;
        }
    }
}

// modes: 0 mix, 1 add, 2 mul, 3 screen, 4 overlay, 5 min, 6 max, 7 sub
fn opBlend(ctx: *TexCtx, p: [*]const f32) void {
    const mode: u32 = @intFromFloat(@max(0.0, p[0]));
    const amount = clamp01(p[1]);
    const b = ctx.pop();
    const a = ctx.pop();
    const dst = ctx.push();
    const n = texPixels(ctx);
    var i: u32 = 0;
    while (i < n) : (i += 1) {
        var c: u32 = 0;
        while (c < 4) : (c += 1) {
            const va = a[i * 4 + c];
            const vb = b[i * 4 + c];
            const blended = switch (mode) {
                0 => vb,
                1 => va + vb,
                2 => va * vb,
                3 => 1.0 - (1.0 - va) * (1.0 - vb),
                4 => if (va < 0.5) 2.0 * va * vb else 1.0 - 2.0 * (1.0 - va) * (1.0 - vb),
                5 => @min(va, vb),
                6 => @max(va, vb),
                else => va - vb,
            };
            dst[i * 4 + c] = clamp01(lerp(va, blended, amount));
        }
    }
}

export fn tex_eval(n_words: u32, size: u32) u32 {
    arenaInit();
    var ctx = TexCtx{ .size = size, .stack = undefined, .depth = 0 };
    var pc: u32 = 0;
    while (pc < n_words) {
        const opcode: u32 = @intFromFloat(cmd_buf[pc]);
        const nparams: u32 = @intFromFloat(cmd_buf[pc + 1]);
        const params: [*]const f32 = @ptrCast(&cmd_buf[pc + 2]);
        switch (opcode) {
            1 => opSolid(&ctx, params),
            2 => opNoise(&ctx, params),
            3 => opShape(&ctx, params),
            4 => opCells(&ctx, params),
            5 => opVoronoi(&ctx, params),
            6 => opBricks(&ctx, params),
            16 => opColorize(&ctx, params),
            17 => opAdjust(&ctx, params),
            18 => opInvert(&ctx, params),
            19 => opTransform(&ctx, params),
            20 => opBlur(&ctx, params),
            21 => opDistort(&ctx, params),
            32 => opBlend(&ctx, params),
            else => {},
        }
        pc += 2 + nparams;
    }
    // Convert top of stack to RGBA8 for GL upload / canvas preview.
    const src = ctx.pop();
    const n = size * size;
    const out = arenaAlloc(u8, n * 4);
    var i: u32 = 0;
    while (i < n * 4) : (i += 1) {
        out[i] = @intFromFloat(clamp01(src[i]) * 255.0);
    }
    return @intFromPtr(out);
}

// ---------------------------------------------------------------------------
// Mesh evaluation
// ---------------------------------------------------------------------------
// Vertex layout: position(3) normal(3) uv(2) = 8 f32. Indexed triangles, u32.

const VSTRIDE = 8;
const MESH_STACK_MAX = 8;

const Mesh = struct {
    v: [*]f32,
    nv: u32,
    idx: [*]u32,
    ni: u32,
};

const MeshCtx = struct {
    stack: [MESH_STACK_MAX]Mesh,
    depth: u32,

    fn push(self: *MeshCtx, m: Mesh) void {
        if (self.depth < MESH_STACK_MAX) {
            self.stack[self.depth] = m;
            self.depth += 1;
        }
    }

    fn pop(self: *MeshCtx) Mesh {
        if (self.depth == 0) {
            return .{ .v = arenaAlloc(f32, 1), .nv = 0, .idx = arenaAlloc(u32, 1), .ni = 0 };
        }
        self.depth -= 1;
        return self.stack[self.depth];
    }
};

fn meshAlloc(nv: u32, ni: u32) Mesh {
    return .{
        .v = arenaAlloc(f32, nv * VSTRIDE),
        .nv = nv,
        .idx = arenaAlloc(u32, ni),
        .ni = ni,
    };
}

fn setV(m: Mesh, i: u32, px: f32, py: f32, pz: f32, nx: f32, ny: f32, nz: f32, u: f32, v: f32) void {
    const o = i * VSTRIDE;
    m.v[o + 0] = px;
    m.v[o + 1] = py;
    m.v[o + 2] = pz;
    m.v[o + 3] = nx;
    m.v[o + 4] = ny;
    m.v[o + 5] = nz;
    m.v[o + 6] = u;
    m.v[o + 7] = v;
}

// Emit an (su+1)x(sv+1) grid of vertices via callback-ish inline loop, then
// stitch quads. Used by sphere / cylinder side / torus / plane.
fn gridIndices(m: Mesh, base_i: u32, base_v: u32, su: u32, sv: u32, flip: bool) void {
    var ii = base_i;
    var y: u32 = 0;
    while (y < sv) : (y += 1) {
        var x: u32 = 0;
        while (x < su) : (x += 1) {
            const a = base_v + y * (su + 1) + x;
            const b = a + 1;
            const c = a + (su + 1);
            const d = c + 1;
            if (!flip) {
                m.idx[ii + 0] = a;
                m.idx[ii + 1] = c;
                m.idx[ii + 2] = b;
                m.idx[ii + 3] = b;
                m.idx[ii + 4] = c;
                m.idx[ii + 5] = d;
            } else {
                m.idx[ii + 0] = a;
                m.idx[ii + 1] = b;
                m.idx[ii + 2] = c;
                m.idx[ii + 3] = b;
                m.idx[ii + 4] = d;
                m.idx[ii + 5] = c;
            }
            ii += 6;
        }
    }
}

fn opCube(ctx: *MeshCtx, p: [*]const f32) void {
    const sx = @max(0.001, p[0]) * 0.5;
    const sy = @max(0.001, p[1]) * 0.5;
    const sz = @max(0.001, p[2]) * 0.5;
    const seg: u32 = @intFromFloat(@max(1.0, @min(32.0, p[3])));
    const nvf = (seg + 1) * (seg + 1); // verts per face
    const nif = seg * seg * 6;
    const m = meshAlloc(nvf * 6, nif * 6);
    // face definitions: normal axis, u axis, v axis, extents
    const faces = [6][9]f32{
        .{ 0, 0, 1, 1, 0, 0, 0, 1, 0 }, // +z
        .{ 0, 0, -1, -1, 0, 0, 0, 1, 0 }, // -z
        .{ 1, 0, 0, 0, 0, -1, 0, 1, 0 }, // +x
        .{ -1, 0, 0, 0, 0, 1, 0, 1, 0 }, // -x
        .{ 0, 1, 0, 1, 0, 0, 0, 0, 1 }, // +y
        .{ 0, -1, 0, 1, 0, 0, 0, 0, -1 }, // -y
    };
    var f: u32 = 0;
    var vi: u32 = 0;
    while (f < 6) : (f += 1) {
        const fc = faces[f];
        const nx = fc[0];
        const ny = fc[1];
        const nz = fc[2];
        var y: u32 = 0;
        while (y <= seg) : (y += 1) {
            const tv = @as(f32, @floatFromInt(y)) / @as(f32, @floatFromInt(seg));
            var x: u32 = 0;
            while (x <= seg) : (x += 1) {
                const tu = @as(f32, @floatFromInt(x)) / @as(f32, @floatFromInt(seg));
                const au = tu * 2.0 - 1.0;
                const av = tv * 2.0 - 1.0;
                const px = (nx + fc[3] * au + fc[6] * av) * sx;
                const py = (ny + fc[4] * au + fc[7] * av) * sy;
                const pz = (nz + fc[5] * au + fc[8] * av) * sz;
                setV(m, vi, px, py, pz, nx, ny, nz, tu, tv);
                vi += 1;
            }
        }
        gridIndices(m, nif * f, nvf * f, seg, seg, false);
    }
    ctx.push(m);
}

fn opSphere(ctx: *MeshCtx, p: [*]const f32) void {
    const r = @max(0.001, p[0]);
    const su: u32 = @intFromFloat(@max(3.0, @min(128.0, p[1])));
    const sv: u32 = @intFromFloat(@max(2.0, @min(128.0, p[2])));
    const m = meshAlloc((su + 1) * (sv + 1), su * sv * 6);
    var vi: u32 = 0;
    var y: u32 = 0;
    while (y <= sv) : (y += 1) {
        const tv = @as(f32, @floatFromInt(y)) / @as(f32, @floatFromInt(sv));
        const phi = tv * math.pi;
        var x: u32 = 0;
        while (x <= su) : (x += 1) {
            const tu = @as(f32, @floatFromInt(x)) / @as(f32, @floatFromInt(su));
            const theta = tu * math.tau;
            const nx = math.sin(phi) * math.cos(theta);
            const ny = math.cos(phi);
            const nz = math.sin(phi) * math.sin(theta);
            setV(m, vi, nx * r, ny * r, nz * r, nx, ny, nz, tu, tv);
            vi += 1;
        }
    }
    gridIndices(m, 0, 0, su, sv, false);
    ctx.push(m);
}

fn opCylinder(ctx: *MeshCtx, p: [*]const f32) void {
    const r = @max(0.001, p[0]);
    const h = @max(0.001, p[1]);
    const su: u32 = @intFromFloat(@max(3.0, @min(128.0, p[2])));
    const sv: u32 = @intFromFloat(@max(1.0, @min(64.0, p[3])));
    const capped = p[4] > 0.5;
    const side_nv = (su + 1) * (sv + 1);
    const side_ni = su * sv * 6;
    const cap_nv: u32 = if (capped) 2 * (su + 2) else 0;
    const cap_ni: u32 = if (capped) 2 * su * 3 else 0;
    const m = meshAlloc(side_nv + cap_nv, side_ni + cap_ni);
    var vi: u32 = 0;
    var y: u32 = 0;
    while (y <= sv) : (y += 1) {
        const tv = @as(f32, @floatFromInt(y)) / @as(f32, @floatFromInt(sv));
        const py = (tv - 0.5) * h;
        var x: u32 = 0;
        while (x <= su) : (x += 1) {
            const tu = @as(f32, @floatFromInt(x)) / @as(f32, @floatFromInt(su));
            const theta = tu * math.tau;
            const nx = math.cos(theta);
            const nz = math.sin(theta);
            setV(m, vi, nx * r, py, nz * r, nx, 0, nz, tu, tv);
            vi += 1;
        }
    }
    gridIndices(m, 0, 0, su, sv, false);
    if (capped) {
        var cap: u32 = 0;
        var ii = side_ni;
        while (cap < 2) : (cap += 1) {
            const ny: f32 = if (cap == 0) 1.0 else -1.0;
            const py = ny * h * 0.5;
            const center = vi;
            setV(m, vi, 0, py, 0, 0, ny, 0, 0.5, 0.5);
            vi += 1;
            var x: u32 = 0;
            while (x <= su) : (x += 1) {
                const tu = @as(f32, @floatFromInt(x)) / @as(f32, @floatFromInt(su));
                const theta = tu * math.tau;
                const cx = math.cos(theta);
                const cz = math.sin(theta);
                setV(m, vi, cx * r, py, cz * r, 0, ny, 0, 0.5 + cx * 0.5, 0.5 + cz * 0.5);
                vi += 1;
            }
            var x2: u32 = 0;
            while (x2 < su) : (x2 += 1) {
                m.idx[ii + 0] = center;
                if (cap == 0) {
                    m.idx[ii + 1] = center + 1 + x2 + 1;
                    m.idx[ii + 2] = center + 1 + x2;
                } else {
                    m.idx[ii + 1] = center + 1 + x2;
                    m.idx[ii + 2] = center + 1 + x2 + 1;
                }
                ii += 3;
            }
        }
    }
    ctx.push(m);
}

fn opTorus(ctx: *MeshCtx, p: [*]const f32) void {
    const R = @max(0.001, p[0]);
    const r = @max(0.001, p[1]);
    const su: u32 = @intFromFloat(@max(3.0, @min(128.0, p[2])));
    const sv: u32 = @intFromFloat(@max(3.0, @min(128.0, p[3])));
    const m = meshAlloc((su + 1) * (sv + 1), su * sv * 6);
    var vi: u32 = 0;
    var y: u32 = 0;
    while (y <= sv) : (y += 1) {
        const tv = @as(f32, @floatFromInt(y)) / @as(f32, @floatFromInt(sv));
        const phi = tv * math.tau; // around the tube
        var x: u32 = 0;
        while (x <= su) : (x += 1) {
            const tu = @as(f32, @floatFromInt(x)) / @as(f32, @floatFromInt(su));
            const theta = tu * math.tau; // around the ring
            const cx = math.cos(theta);
            const cz = math.sin(theta);
            const nx = cx * math.cos(phi);
            const ny = math.sin(phi);
            const nz = cz * math.cos(phi);
            const px = cx * (R + r * math.cos(phi));
            const py = r * math.sin(phi);
            const pz = cz * (R + r * math.cos(phi));
            setV(m, vi, px, py, pz, nx, ny, nz, tu * 3.0, tv);
            vi += 1;
        }
    }
    gridIndices(m, 0, 0, su, sv, true);
    ctx.push(m);
}

fn opGrid(ctx: *MeshCtx, p: [*]const f32) void {
    const w = @max(0.001, p[0]) * 0.5;
    const d = @max(0.001, p[1]) * 0.5;
    const su: u32 = @intFromFloat(@max(1.0, @min(256.0, p[2])));
    const sv: u32 = @intFromFloat(@max(1.0, @min(256.0, p[3])));
    const m = meshAlloc((su + 1) * (sv + 1), su * sv * 6);
    var vi: u32 = 0;
    var y: u32 = 0;
    while (y <= sv) : (y += 1) {
        const tv = @as(f32, @floatFromInt(y)) / @as(f32, @floatFromInt(sv));
        var x: u32 = 0;
        while (x <= su) : (x += 1) {
            const tu = @as(f32, @floatFromInt(x)) / @as(f32, @floatFromInt(su));
            setV(m, vi, (tu * 2.0 - 1.0) * w, 0, (tv * 2.0 - 1.0) * d, 0, 1, 0, tu, tv);
            vi += 1;
        }
    }
    gridIndices(m, 0, 0, su, sv, true);
    ctx.push(m);
}

fn rotXYZ(x: f32, y: f32, z: f32, rx: f32, ry: f32, rz: f32, out: *[3]f32) void {
    var px = x;
    var py = y;
    var pz = z;
    // X
    var c = math.cos(rx);
    var s = math.sin(rx);
    var t1 = py * c - pz * s;
    var t2 = py * s + pz * c;
    py = t1;
    pz = t2;
    // Y
    c = math.cos(ry);
    s = math.sin(ry);
    t1 = px * c + pz * s;
    t2 = -px * s + pz * c;
    px = t1;
    pz = t2;
    // Z
    c = math.cos(rz);
    s = math.sin(rz);
    t1 = px * c - py * s;
    t2 = px * s + py * c;
    px = t1;
    py = t2;
    out[0] = px;
    out[1] = py;
    out[2] = pz;
}

fn opMeshTransform(ctx: *MeshCtx, p: [*]const f32) void {
    const src = ctx.pop();
    const m = meshAlloc(src.nv, src.ni);
    var i: u32 = 0;
    while (i < src.ni) : (i += 1) m.idx[i] = src.idx[i];
    var vi: u32 = 0;
    while (vi < src.nv) : (vi += 1) {
        const o = vi * VSTRIDE;
        var pos: [3]f32 = undefined;
        var nrm: [3]f32 = undefined;
        rotXYZ(src.v[o + 0] * p[6], src.v[o + 1] * p[7], src.v[o + 2] * p[8], p[3], p[4], p[5], &pos);
        rotXYZ(src.v[o + 3], src.v[o + 4], src.v[o + 5], p[3], p[4], p[5], &nrm);
        const nl = @sqrt(nrm[0] * nrm[0] + nrm[1] * nrm[1] + nrm[2] * nrm[2]);
        const inl = if (nl > 0.0001) 1.0 / nl else 0.0;
        m.v[o + 0] = pos[0] + p[0];
        m.v[o + 1] = pos[1] + p[1];
        m.v[o + 2] = pos[2] + p[2];
        m.v[o + 3] = nrm[0] * inl;
        m.v[o + 4] = nrm[1] * inl;
        m.v[o + 5] = nrm[2] * inl;
        m.v[o + 6] = src.v[o + 6];
        m.v[o + 7] = src.v[o + 7];
    }
    ctx.push(m);
}

fn recomputeNormals(m: Mesh) void {
    var vi: u32 = 0;
    while (vi < m.nv) : (vi += 1) {
        m.v[vi * VSTRIDE + 3] = 0;
        m.v[vi * VSTRIDE + 4] = 0;
        m.v[vi * VSTRIDE + 5] = 0;
    }
    var t: u32 = 0;
    while (t + 2 < m.ni) : (t += 3) {
        const ia = m.idx[t] * VSTRIDE;
        const ib = m.idx[t + 1] * VSTRIDE;
        const ic = m.idx[t + 2] * VSTRIDE;
        const e1x = m.v[ib + 0] - m.v[ia + 0];
        const e1y = m.v[ib + 1] - m.v[ia + 1];
        const e1z = m.v[ib + 2] - m.v[ia + 2];
        const e2x = m.v[ic + 0] - m.v[ia + 0];
        const e2y = m.v[ic + 1] - m.v[ia + 1];
        const e2z = m.v[ic + 2] - m.v[ia + 2];
        const cx = e1y * e2z - e1z * e2y;
        const cy = e1z * e2x - e1x * e2z;
        const cz = e1x * e2y - e1y * e2x;
        inline for (.{ ia, ib, ic }) |ii| {
            m.v[ii + 3] += cx;
            m.v[ii + 4] += cy;
            m.v[ii + 5] += cz;
        }
    }
    vi = 0;
    while (vi < m.nv) : (vi += 1) {
        const o = vi * VSTRIDE;
        const l = @sqrt(m.v[o + 3] * m.v[o + 3] + m.v[o + 4] * m.v[o + 4] + m.v[o + 5] * m.v[o + 5]);
        if (l > 0.0001) {
            m.v[o + 3] /= l;
            m.v[o + 4] /= l;
            m.v[o + 5] /= l;
        }
    }
}

fn opDisplace(ctx: *MeshCtx, p: [*]const f32) void {
    const amount = p[0];
    const scale = @max(0.01, p[1]);
    const octaves: u32 = @intFromFloat(@max(1.0, @min(6.0, p[2])));
    const seed: u32 = @intFromFloat(@max(0.0, p[3]));
    const src = ctx.pop();
    const m = meshAlloc(src.nv, src.ni);
    var i: u32 = 0;
    while (i < src.ni) : (i += 1) m.idx[i] = src.idx[i];
    var vi: u32 = 0;
    while (vi < src.nv) : (vi += 1) {
        const o = vi * VSTRIDE;
        const d = (fbm3(src.v[o + 0] * scale, src.v[o + 1] * scale, src.v[o + 2] * scale, octaves, seed) - 0.5) * 2.0 * amount;
        m.v[o + 0] = src.v[o + 0] + src.v[o + 3] * d;
        m.v[o + 1] = src.v[o + 1] + src.v[o + 4] * d;
        m.v[o + 2] = src.v[o + 2] + src.v[o + 5] * d;
        m.v[o + 3] = src.v[o + 3];
        m.v[o + 4] = src.v[o + 4];
        m.v[o + 5] = src.v[o + 5];
        m.v[o + 6] = src.v[o + 6];
        m.v[o + 7] = src.v[o + 7];
    }
    recomputeNormals(m);
    ctx.push(m);
}

fn opTwist(ctx: *MeshCtx, p: [*]const f32) void {
    const amount = p[0]; // radians per unit of Y
    const src = ctx.pop();
    const m = meshAlloc(src.nv, src.ni);
    var i: u32 = 0;
    while (i < src.ni) : (i += 1) m.idx[i] = src.idx[i];
    var vi: u32 = 0;
    while (vi < src.nv) : (vi += 1) {
        const o = vi * VSTRIDE;
        const a = src.v[o + 1] * amount;
        const c = math.cos(a);
        const s = math.sin(a);
        m.v[o + 0] = src.v[o + 0] * c - src.v[o + 2] * s;
        m.v[o + 1] = src.v[o + 1];
        m.v[o + 2] = src.v[o + 0] * s + src.v[o + 2] * c;
        m.v[o + 3] = src.v[o + 3];
        m.v[o + 4] = src.v[o + 4];
        m.v[o + 5] = src.v[o + 5];
        m.v[o + 6] = src.v[o + 6];
        m.v[o + 7] = src.v[o + 7];
    }
    recomputeNormals(m);
    ctx.push(m);
}

// mode 0: linear array (offset dx,dy,dz per copy)
// mode 1: radial array around Y axis (radius, per-copy Y rotation faces out)
fn opArray(ctx: *MeshCtx, p: [*]const f32) void {
    const mode: u32 = @intFromFloat(@max(0.0, p[0]));
    const count: u32 = @intFromFloat(@max(1.0, @min(256.0, p[1])));
    const src = ctx.pop();
    const m = meshAlloc(src.nv * count, src.ni * count);
    var k: u32 = 0;
    while (k < count) : (k += 1) {
        const fk: f32 = @floatFromInt(k);
        var vi: u32 = 0;
        while (vi < src.nv) : (vi += 1) {
            const so = vi * VSTRIDE;
            const doff = (k * src.nv + vi) * VSTRIDE;
            if (mode == 0) {
                m.v[doff + 0] = src.v[so + 0] + p[2] * fk;
                m.v[doff + 1] = src.v[so + 1] + p[3] * fk;
                m.v[doff + 2] = src.v[so + 2] + p[4] * fk;
                m.v[doff + 3] = src.v[so + 3];
                m.v[doff + 4] = src.v[so + 4];
                m.v[doff + 5] = src.v[so + 5];
            } else {
                const ang = math.tau * fk / @as(f32, @floatFromInt(count));
                const c = math.cos(ang);
                const s = math.sin(ang);
                const px = src.v[so + 0] + p[2]; // p[2] = radius
                const pz = src.v[so + 2];
                m.v[doff + 0] = px * c - pz * s;
                m.v[doff + 1] = src.v[so + 1];
                m.v[doff + 2] = px * s + pz * c;
                const nx = src.v[so + 3];
                const nz = src.v[so + 5];
                m.v[doff + 3] = nx * c - nz * s;
                m.v[doff + 4] = src.v[so + 4];
                m.v[doff + 5] = nx * s + nz * c;
            }
            m.v[doff + 6] = src.v[so + 6];
            m.v[doff + 7] = src.v[so + 7];
        }
        var ii: u32 = 0;
        while (ii < src.ni) : (ii += 1) {
            m.idx[k * src.ni + ii] = src.idx[ii] + k * src.nv;
        }
    }
    ctx.push(m);
}

fn opMerge(ctx: *MeshCtx, _: [*]const f32) void {
    const b = ctx.pop();
    const a = ctx.pop();
    const m = meshAlloc(a.nv + b.nv, a.ni + b.ni);
    var i: u32 = 0;
    while (i < a.nv * VSTRIDE) : (i += 1) m.v[i] = a.v[i];
    i = 0;
    while (i < b.nv * VSTRIDE) : (i += 1) m.v[a.nv * VSTRIDE + i] = b.v[i];
    i = 0;
    while (i < a.ni) : (i += 1) m.idx[i] = a.idx[i];
    i = 0;
    while (i < b.ni) : (i += 1) m.idx[a.ni + i] = b.idx[i] + a.nv;
    ctx.push(m);
}

// Result header: [nv, ni, vptr, iptr] as u32.
var mesh_result: [4]u32 = undefined;

export fn mesh_eval(n_words: u32) u32 {
    arenaInit();
    var ctx = MeshCtx{ .stack = undefined, .depth = 0 };
    var pc: u32 = 0;
    while (pc < n_words) {
        const opcode: u32 = @intFromFloat(cmd_buf[pc]);
        const nparams: u32 = @intFromFloat(cmd_buf[pc + 1]);
        const params: [*]const f32 = @ptrCast(&cmd_buf[pc + 2]);
        switch (opcode) {
            1 => opCube(&ctx, params),
            2 => opSphere(&ctx, params),
            3 => opCylinder(&ctx, params),
            4 => opTorus(&ctx, params),
            5 => opGrid(&ctx, params),
            16 => opMeshTransform(&ctx, params),
            17 => opDisplace(&ctx, params),
            18 => opTwist(&ctx, params),
            19 => opArray(&ctx, params),
            32 => opMerge(&ctx, params),
            else => {},
        }
        pc += 2 + nparams;
    }
    const m = ctx.pop();
    mesh_result[0] = m.nv;
    mesh_result[1] = m.ni;
    mesh_result[2] = @intFromPtr(m.v);
    mesh_result[3] = @intFromPtr(m.idx);
    return @intFromPtr(&mesh_result);
}
