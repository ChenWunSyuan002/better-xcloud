// AMD FidelityFX Super Resolution 1.0 - RCAS (Robust Contrast-Adaptive Sharpening)
// Source: https://www.shadertoy.com/view/stXSWB by goingdigital
// Based on AMD FSR 1.0 (MIT License) - https://gpuopen.com/fsr

struct RcasParams {
    resolution: vec2<f32>,
    sharpness: f32,
    brightness: f32,
    contrast: f32,
    saturation: f32,
};

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var ourSampler: sampler;
@group(0) @binding(1) var ourTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: RcasParams;

const LUMINOSITY_FACTOR = vec3<f32>(0.299, 0.587, 0.114);
const FSR_RCAS_LIMIT: f32 = 0.25 - 1.0 / 16.0;

@vertex
fn vsMain(@location(0) pos: vec2<f32>) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4<f32>(pos, 0.0, 1.0);
    return out;
}

fn FsrRcasLoadF(p: vec2<f32>) -> vec4<f32> {
    return textureSample(ourTexture, ourSampler, p / params.resolution);
}

fn FsrRcasF(ip: vec2<f32>, con: f32) -> vec3<f32> {
    let sp = ip;
    let b = FsrRcasLoadF(sp + vec2<f32>(0.0, -1.0)).rgb;
    let d = FsrRcasLoadF(sp + vec2<f32>(-1.0, 0.0)).rgb;
    let e = FsrRcasLoadF(sp).rgb;
    let f = FsrRcasLoadF(sp + vec2<f32>(1.0, 0.0)).rgb;
    let h = FsrRcasLoadF(sp + vec2<f32>(0.0, 1.0)).rgb;

    let bL = b.g + 0.5 * (b.b + b.r);
    let dL = d.g + 0.5 * (d.b + d.r);
    let eL = e.g + 0.5 * (e.b + e.r);
    let fL = f.g + 0.5 * (f.b + f.r);
    let hL = h.g + 0.5 * (h.b + h.r);

    // Noise detection
    let nz_raw = 0.25 * (bL + dL + fL + hL) - eL;
    var nz = clamp(
        abs(nz_raw) / (
            max(max(bL, dL), max(eL, max(fL, hL)))
            - min(min(bL, dL), min(eL, min(fL, hL)))
        ),
        0.0, 1.0,
    );
    nz = 1.0 - 0.5 * nz;

    // Min and max of ring
    let mn4 = min(b, min(f, h));
    let mx4 = max(b, max(f, h));

    // Immediate constants for peak range
    let peakC = vec2<f32>(1.0, -4.0);

    // Limiters
    let hitMin = mn4 / (4.0 * mx4);
    let hitMax = (peakC.x - mx4) / (4.0 * mn4 + peakC.y);
    let lobeRGB = max(-hitMin, hitMax);
    var lobe = max(
        -FSR_RCAS_LIMIT,
        min(max(lobeRGB.r, max(lobeRGB.g, lobeRGB.b)), 0.0),
    ) * con;

    // Apply noise removal
    lobe *= nz;

    // Resolve
    return (lobe * (b + d + h + f) + e) / (4.0 * lobe + 1.0);
}

@fragment
fn fsMain(input: VertexOutput) -> @location(0) vec4<f32> {
    // Set up constants
    let con = exp2(-params.sharpness);

    // Perform RCAS pass
    var color = FsrRcasF(input.position.xy, con);

    // Saturation
    color = mix(vec3<f32>(dot(color, LUMINOSITY_FACTOR)), color, params.saturation);

    // Contrast
    color = params.contrast * (color - 0.5) + 0.5;

    // Brightness
    color = params.brightness * color;

    return vec4<f32>(color, 1.0);
}
