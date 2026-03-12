#version 300 es

// AMD FidelityFX Super Resolution 1.0 - RCAS (Robust Contrast-Adaptive Sharpening)
// Source: https://www.shadertoy.com/view/stXSWB by goingdigital
// Based on AMD FSR 1.0 (MIT License) - https://gpuopen.com/fsr

precision mediump float;

uniform vec2 iResolution;
uniform float sharpness;
uniform sampler2D iChannel0;
uniform float brightness;
uniform float contrast;
uniform float saturation;

out vec4 fragColor;

// Luminosity factor
const vec3 LUMINOSITY_FACTOR = vec3(0.299, 0.587, 0.114);

/***** RCAS *****/
#define FSR_RCAS_LIMIT (0.25 - (1.0 / 16.0))

void FsrRcasCon(
    out float con,
    float sharpness
) {
    con = exp2(-sharpness);
}

vec4 FsrRcasLoadF(vec2 p) {
    return texture(iChannel0, p / iResolution.xy);
}

vec3 FsrRcasF(
    vec2 ip,
    float con
) {
    //    b
    //  d e f
    //    h
    vec2 sp = vec2(ip);
    vec3 b = FsrRcasLoadF(sp + vec2( 0, -1)).rgb;
    vec3 d = FsrRcasLoadF(sp + vec2(-1,  0)).rgb;
    vec3 e = FsrRcasLoadF(sp).rgb;
    vec3 f = FsrRcasLoadF(sp + vec2( 1,  0)).rgb;
    vec3 h = FsrRcasLoadF(sp + vec2( 0,  1)).rgb;

    // Luma times 2.
    float bL = b.g + .5 * (b.b + b.r);
    float dL = d.g + .5 * (d.b + d.r);
    float eL = e.g + .5 * (e.b + e.r);
    float fL = f.g + .5 * (f.b + f.r);
    float hL = h.g + .5 * (h.b + h.r);

    // Noise detection.
    float nz = .25 * (bL + dL + fL + hL) - eL;
    nz = clamp(
        abs(nz)
        / (
            max(max(bL, dL), max(eL, max(fL, hL)))
            - min(min(bL, dL), min(eL, min(fL, hL)))
        ),
        0., 1.
    );
    nz = 1. - .5 * nz;

    // Min and max of ring.
    vec3 mn4 = min(b, min(f, h));
    vec3 mx4 = max(b, max(f, h));

    // Immediate constants for peak range.
    vec2 peakC = vec2(1., -4.);

    // Limiters
    vec3 hitMin = mn4 / (4. * mx4);
    vec3 hitMax = (peakC.x - mx4) / (4. * mn4 + peakC.y);
    vec3 lobeRGB = max(-hitMin, hitMax);
    float lobe = max(
        -FSR_RCAS_LIMIT,
        min(max(lobeRGB.r, max(lobeRGB.g, lobeRGB.b)), 0.)
    ) * con;

    // Apply noise removal.
    lobe *= nz;

    // Resolve
    return (lobe * (b + d + h + f) + e) / (4. * lobe + 1.);
}

void main()
{
    vec4 fragCoord = gl_FragCoord;

    // Set up constants
    float con;
    FsrRcasCon(con, sharpness);

    // Perform RCAS pass
    vec3 color = FsrRcasF(fragCoord.xy, con);

    // Saturation
    color = mix(vec3(dot(color, LUMINOSITY_FACTOR)), color, saturation);

    // Contrast
    color = contrast * (color - 0.5) + 0.5;

    // Brightness
    color = brightness * color;

    fragColor = vec4(color, 1);
}
