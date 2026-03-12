// AMD FidelityFX Super Resolution 1.0 - EASU (Edge Adaptive Spatial Upsampling)
// Source: https://www.shadertoy.com/view/stXSWB by goingdigital
// Based on AMD FSR 1.0 (MIT License) - https://gpuopen.com/fsr

struct EasuParams {
    resolution: vec2<f32>,
};

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var ourSampler: sampler;
@group(0) @binding(1) var ourTexture: texture_external;
@group(0) @binding(2) var<uniform> params: EasuParams;

@vertex
fn vsMain(@location(0) pos: vec2<f32>) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4<f32>(pos, 0.0, 1.0);
    return out;
}

fn FsrEasuCF(p: vec2<f32>) -> vec3<f32> {
    return textureSampleBaseClampToEdge(ourTexture, ourSampler, p).rgb;
}

fn FsrEasuCon(
    inputViewportInPixels: vec2<f32>,
    inputSizeInPixels: vec2<f32>,
    outputSizeInPixels: vec2<f32>,
) -> array<vec4<f32>, 4> {
    let con0 = vec4<f32>(
        inputViewportInPixels.x / outputSizeInPixels.x,
        inputViewportInPixels.y / outputSizeInPixels.y,
        0.5 * inputViewportInPixels.x / outputSizeInPixels.x - 0.5,
        0.5 * inputViewportInPixels.y / outputSizeInPixels.y - 0.5,
    );
    let con1 = vec4<f32>(1.0, 1.0, 1.0, -1.0) / inputSizeInPixels.xyxy;
    let con2 = vec4<f32>(-1.0, 2.0, 1.0, 2.0) / inputSizeInPixels.xyxy;
    let con3 = vec4<f32>(0.0, 4.0, 0.0, 0.0) / inputSizeInPixels.xyxy;
    return array<vec4<f32>, 4>(con0, con1, con2, con3);
}

fn FsrEasuTapF(
    aC: ptr<function, vec3<f32>>,
    aW: ptr<function, f32>,
    off: vec2<f32>,
    dir: vec2<f32>,
    len: vec2<f32>,
    lob: f32,
    clp: f32,
    c: vec3<f32>,
) {
    let v = vec2<f32>(dot(off, dir), dot(off, vec2<f32>(-dir.y, dir.x))) * len;
    let d2 = min(dot(v, v), clp);
    var wB = 0.4 * d2 - 1.0;
    var wA = lob * d2 - 1.0;
    wB = wB * wB;
    wA = wA * wA;
    wB = 1.5625 * wB - 0.5625;
    let w = wB * wA;
    *aC += c * w;
    *aW += w;
}

fn FsrEasuSetF(
    dir: ptr<function, vec2<f32>>,
    lenAccum: ptr<function, f32>,
    w: f32,
    lA: f32, lB: f32, lC: f32, lD: f32, lE: f32,
) {
    let lenX = max(abs(lD - lC), abs(lC - lB));
    let dirX = lD - lB;
    (*dir).x += dirX * w;
    var lenXn = clamp(abs(dirX) / lenX, 0.0, 1.0);
    lenXn = lenXn * lenXn;
    *lenAccum += lenXn * w;

    let lenY = max(abs(lE - lC), abs(lC - lA));
    let dirY = lE - lA;
    (*dir).y += dirY * w;
    var lenYn = clamp(abs(dirY) / lenY, 0.0, 1.0);
    lenYn = lenYn * lenYn;
    *lenAccum += lenYn * w;
}

fn FsrEasuF(
    ip: vec2<f32>,
    con0: vec4<f32>,
    con1: vec4<f32>,
    con2: vec4<f32>,
    con3: vec4<f32>,
) -> vec3<f32> {
    var pp = ip * con0.xy + con0.zw;
    let fp = floor(pp);
    pp -= fp;

    let p0 = fp * con1.xy + con1.zw;
    let p1 = p0 + con2.xy;
    let p2 = p0 + con2.zw;
    let p3 = p0 + con3.xy;

    let off = vec4<f32>(-0.5, 0.5, -0.5, 0.5) * con1.xxyy;

    let bC = FsrEasuCF(p0 + off.xw);
    let bL = bC.g + 0.5 * (bC.r + bC.b);
    let cC = FsrEasuCF(p0 + off.yw);
    let cL = cC.g + 0.5 * (cC.r + cC.b);
    let iC_s = FsrEasuCF(p1 + off.xw);
    let iL = iC_s.g + 0.5 * (iC_s.r + iC_s.b);
    let jC = FsrEasuCF(p1 + off.yw);
    let jL = jC.g + 0.5 * (jC.r + jC.b);
    let fC = FsrEasuCF(p1 + off.yz);
    let fL = fC.g + 0.5 * (fC.r + fC.b);
    let eC = FsrEasuCF(p1 + off.xz);
    let eL = eC.g + 0.5 * (eC.r + eC.b);
    let kC = FsrEasuCF(p2 + off.xw);
    let kL = kC.g + 0.5 * (kC.r + kC.b);
    let lC_s = FsrEasuCF(p2 + off.yw);
    let lL = lC_s.g + 0.5 * (lC_s.r + lC_s.b);
    let hC = FsrEasuCF(p2 + off.yz);
    let hL = hC.g + 0.5 * (hC.r + hC.b);
    let gC = FsrEasuCF(p2 + off.xz);
    let gL = gC.g + 0.5 * (gC.r + gC.b);
    let oC = FsrEasuCF(p3 + off.yz);
    let oL = oC.g + 0.5 * (oC.r + oC.b);
    let nC = FsrEasuCF(p3 + off.xz);
    let nL = nC.g + 0.5 * (nC.r + nC.b);

    var dir = vec2<f32>(0.0);
    var lenAccum = 0.0;

    FsrEasuSetF(&dir, &lenAccum, (1.0 - pp.x) * (1.0 - pp.y), bL, eL, fL, gL, jL);
    FsrEasuSetF(&dir, &lenAccum, pp.x * (1.0 - pp.y), cL, fL, gL, hL, kL);
    FsrEasuSetF(&dir, &lenAccum, (1.0 - pp.x) * pp.y, fL, iL, jL, kL, nL);
    FsrEasuSetF(&dir, &lenAccum, pp.x * pp.y, gL, jL, kL, lL, oL);

    let dir2 = dir * dir;
    let dirR_raw = dir2.x + dir2.y;
    let zro = dirR_raw < (1.0 / 32768.0);
    var dirR = inverseSqrt(dirR_raw);
    dirR = select(dirR, 1.0, zro);
    dir.x = select(dir.x, 1.0, zro);
    dir *= vec2<f32>(dirR);

    lenAccum = lenAccum * 0.5;
    lenAccum = lenAccum * lenAccum;

    let stretch = dot(dir, dir) / max(abs(dir.x), abs(dir.y));
    let len2 = vec2<f32>(1.0 + (stretch - 1.0) * lenAccum, 1.0 - 0.5 * lenAccum);
    let lob = 0.5 - 0.29 * lenAccum;
    let clp = 1.0 / lob;

    let min4 = min(min(fC, gC), min(jC, kC));
    let max4 = max(max(fC, gC), max(jC, kC));

    var aC = vec3<f32>(0.0);
    var aW = 0.0;
    FsrEasuTapF(&aC, &aW, vec2<f32>(0.0, -1.0) - pp, dir, len2, lob, clp, bC);
    FsrEasuTapF(&aC, &aW, vec2<f32>(1.0, -1.0) - pp, dir, len2, lob, clp, cC);
    FsrEasuTapF(&aC, &aW, vec2<f32>(-1.0, 1.0) - pp, dir, len2, lob, clp, iC_s);
    FsrEasuTapF(&aC, &aW, vec2<f32>(0.0, 1.0) - pp, dir, len2, lob, clp, jC);
    FsrEasuTapF(&aC, &aW, vec2<f32>(0.0, 0.0) - pp, dir, len2, lob, clp, fC);
    FsrEasuTapF(&aC, &aW, vec2<f32>(-1.0, 0.0) - pp, dir, len2, lob, clp, eC);
    FsrEasuTapF(&aC, &aW, vec2<f32>(1.0, 1.0) - pp, dir, len2, lob, clp, kC);
    FsrEasuTapF(&aC, &aW, vec2<f32>(2.0, 1.0) - pp, dir, len2, lob, clp, lC_s);
    FsrEasuTapF(&aC, &aW, vec2<f32>(2.0, 0.0) - pp, dir, len2, lob, clp, hC);
    FsrEasuTapF(&aC, &aW, vec2<f32>(1.0, 0.0) - pp, dir, len2, lob, clp, gC);
    FsrEasuTapF(&aC, &aW, vec2<f32>(1.0, 2.0) - pp, dir, len2, lob, clp, oC);
    FsrEasuTapF(&aC, &aW, vec2<f32>(0.0, 2.0) - pp, dir, len2, lob, clp, nC);

    return min(max4, max(min4, aC / aW));
}

@fragment
fn fsMain(input: VertexOutput) -> @location(0) vec4<f32> {
    let rendersize = vec2<f32>(textureDimensions(ourTexture));
    let cons = FsrEasuCon(rendersize, rendersize, params.resolution);
    let c = FsrEasuF(input.position.xy, cons[0], cons[1], cons[2], cons[3]);
    return vec4<f32>(c, 1.0);
}
