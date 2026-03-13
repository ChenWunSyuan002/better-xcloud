import { compressCodeFile } from "@macros/build" with { type: "macro" };

import { StreamPref } from "@/enums/pref-keys";
import { getStreamPref } from "@/utils/pref-utils";
import { BaseCanvasPlayer } from "../base-canvas-player";
import { FsrUpscaleRatio, StreamPlayerType, StreamVideoProcessing, StreamVideoProcessingMode } from "@/enums/pref-values";


export class WebGL2Player extends BaseCanvasPlayer {
    private gl: WebGL2RenderingContext | null = null;
    private resources: Array<WebGLBuffer | WebGLTexture | WebGLProgram | WebGLShader> = [];
    private program: WebGLProgram | null = null;

    // FSR resources
    private easuProgram: WebGLProgram | null = null;
    private rcasProgram: WebGLProgram | null = null;
    private fbo: WebGLFramebuffer | null = null;
    private fboTexture: WebGLTexture | null = null;
    private videoTexture: WebGLTexture | null = null;
    private isFsr = false;

    constructor($video: HTMLVideoElement) {
        super(StreamPlayerType.WEBGL2, $video, 'WebGL2Player');
    }

    private updateCanvas() {
        console.log('updateCanvas', this.options);

        const gl = this.gl!;
        const program = this.program!;
        const filterId = this.toFilterId(this.options.processing);

        gl.uniform2f(gl.getUniformLocation(program, 'iResolution'), this.$canvas.width, this.$canvas.height);

        gl.uniform1i(gl.getUniformLocation(program, 'filterId'), filterId);
        gl.uniform1i(gl.getUniformLocation(program, 'qualityMode'), this.options.processingMode === StreamVideoProcessingMode.QUALITY ? 1 : 0);
        gl.uniform1f(gl.getUniformLocation(program, 'sharpenFactor'), this.options.sharpness / (this.options.processingMode === StreamVideoProcessingMode.QUALITY ? 1 : 1.2));
        gl.uniform1f(gl.getUniformLocation(program, 'brightness'), this.options.brightness / 100);
        gl.uniform1f(gl.getUniformLocation(program, 'contrast'), this.options.contrast / 100);
        gl.uniform1f(gl.getUniformLocation(program, 'saturation'), this.options.saturation / 100);
    }

    private updateFsrCanvas() {
        console.log('updateFsrCanvas', this.options);

        const gl = this.gl!;
        const canvasWidth = this.$canvas.width;
        const canvasHeight = this.$canvas.height;

        // Update EASU uniforms
        gl.useProgram(this.easuProgram);
        gl.uniform2f(gl.getUniformLocation(this.easuProgram!, 'iResolution'), canvasWidth, canvasHeight);

        // Update RCAS uniforms
        gl.useProgram(this.rcasProgram);
        gl.uniform2f(gl.getUniformLocation(this.rcasProgram!, 'iResolution'), canvasWidth, canvasHeight);
        gl.uniform1f(gl.getUniformLocation(this.rcasProgram!, 'sharpness'), (10 - this.options.sharpness) / 5);
        gl.uniform1f(gl.getUniformLocation(this.rcasProgram!, 'brightness'), this.options.brightness / 100);
        gl.uniform1f(gl.getUniformLocation(this.rcasProgram!, 'contrast'), this.options.contrast / 100);
        gl.uniform1f(gl.getUniformLocation(this.rcasProgram!, 'saturation'), this.options.saturation / 100);
    }

    updateFrame() {
        if (this.isFsr) {
            this.updateFsrFrame();
            return;
        }

        const gl = this.gl!;
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, this.$video);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    private updateFsrFrame() {
        const gl = this.gl!;
        const canvasWidth = this.$canvas.width;
        const canvasHeight = this.$canvas.height;

        // Upload video to video texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.videoTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, this.$video);

        // Pass 1: EASU - render video texture to FBO at output resolution
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
        gl.viewport(0, 0, canvasWidth, canvasHeight);
        gl.useProgram(this.easuProgram);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.videoTexture);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        // Pass 2: RCAS - render FBO texture to screen
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvasWidth, canvasHeight);
        gl.useProgram(this.rcasProgram);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.fboTexture);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    private createProgram(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram {
        const vShader = gl.createShader(gl.VERTEX_SHADER)!;
        gl.shaderSource(vShader, vertexSource);
        gl.compileShader(vShader);

        if (!gl.getShaderParameter(vShader, gl.COMPILE_STATUS)) {
            console.error('Vertex shader compile error:', gl.getShaderInfoLog(vShader));
        }

        const fShader = gl.createShader(gl.FRAGMENT_SHADER)!;
        gl.shaderSource(fShader, fragmentSource);
        gl.compileShader(fShader);

        if (!gl.getShaderParameter(fShader, gl.COMPILE_STATUS)) {
            console.error('Fragment shader compile error:', gl.getShaderInfoLog(fShader));
        }

        const program = gl.createProgram()!;
        gl.attachShader(program, vShader);
        gl.attachShader(program, fShader);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error(`Link failed: ${gl.getProgramInfoLog(program)}`);
        }

        this.resources.push(vShader, fShader, program);
        return program;
    }

    private calculateCanvasSize(): { width: number, height: number } {
        const videoWidth = this.$video.videoWidth;
        const videoHeight = this.$video.videoHeight;
        const ratio = this.options.fsrRatio;
        const gl = this.gl!;
        const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;

        if (ratio === FsrUpscaleRatio.AUTO) {
            const screenWidth = window.innerWidth * window.devicePixelRatio;
            const screenHeight = window.innerHeight * window.devicePixelRatio;
            return {
                width: Math.min(Math.round(screenWidth), maxSize),
                height: Math.min(Math.round(screenHeight), maxSize),
            };
        }

        const multiplier = parseFloat(ratio.substring(1));
        return {
            width: Math.min(Math.round(videoWidth * multiplier), maxSize),
            height: Math.min(Math.round(videoHeight * multiplier), maxSize),
        };
    }

    private setupFsrShaders() {
        const gl = this.gl!;
        const vertexSource = compressCodeFile('./src/modules/player/webgl2/shaders/clarity-boost.vert') as any as string;

        // Calculate canvas size for FSR
        const canvasSize = this.calculateCanvasSize();
        this.$canvas.width = canvasSize.width;
        this.$canvas.height = canvasSize.height;

        // Create EASU program
        this.easuProgram = this.createProgram(
            gl,
            vertexSource,
            compressCodeFile('./src/modules/player/webgl2/shaders/fsr-easu.fs') as any as string,
        );

        // Create RCAS program
        this.rcasProgram = this.createProgram(
            gl,
            vertexSource,
            compressCodeFile('./src/modules/player/webgl2/shaders/fsr-rcas.fs') as any as string,
        );

        // Create vertex buffer (shared by both programs)
        const buffer = gl.createBuffer()!;
        this.resources.push(buffer);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1.0, -1.0,
            3.0, -1.0,
            -1.0, 3.0,
        ]), gl.STATIC_DRAW);

        // Setup vertex attrib for both programs
        for (const prog of [this.easuProgram, this.rcasProgram]) {
            gl.useProgram(prog);
            gl.enableVertexAttribArray(0);
            gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        }

        // Create video texture (input)
        this.videoTexture = gl.createTexture()!;
        this.resources.push(this.videoTexture);
        gl.bindTexture(gl.TEXTURE_2D, this.videoTexture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        // Create FBO texture (EASU output / RCAS input)
        this.fboTexture = gl.createTexture()!;
        this.resources.push(this.fboTexture);
        gl.bindTexture(gl.TEXTURE_2D, this.fboTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvasSize.width, canvasSize.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        // Create framebuffer
        this.fbo = gl.createFramebuffer()!;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTexture, 0);

        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
            console.error('Framebuffer not complete:', status);
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        // Bind texture unit 0 for both programs
        gl.useProgram(this.easuProgram);
        gl.uniform1i(gl.getUniformLocation(this.easuProgram, 'iChannel0'), 0);

        gl.useProgram(this.rcasProgram);
        gl.uniform1i(gl.getUniformLocation(this.rcasProgram, 'iChannel0'), 0);

        // Set uniforms
        this.updateFsrCanvas();
    }

    private destroyFsrResources() {
        const gl = this.gl;
        if (!gl) return;

        if (this.fbo) {
            gl.deleteFramebuffer(this.fbo);
            this.fbo = null;
        }

        this.easuProgram = null;
        this.rcasProgram = null;
        this.fboTexture = null;
        this.videoTexture = null;
    }

    protected async setupShaders(): Promise<void> {
        const gl = this.$canvas.getContext('webgl2', {
            isBx: true,
            antialias: true,
            alpha: false,
            depth: false,
            preserveDrawingBuffer: false,
            stencil: false,
            powerPreference: getStreamPref(StreamPref.VIDEO_POWER_PREFERENCE),
        } as WebGLContextAttributes) as WebGL2RenderingContext;
        this.gl = gl;

        this.isFsr = this.options.processing === StreamVideoProcessing.FSR;

        if (this.isFsr) {
            gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
            this.setupFsrShaders();
            return;
        }

        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferWidth);

        // Vertex shader: Identity map
        const vShader = gl.createShader(gl.VERTEX_SHADER)!;
        gl.shaderSource(vShader, compressCodeFile('./src/modules/player/webgl2/shaders/clarity-boost.vert') as any as string);
        gl.compileShader(vShader);

        const fShader = gl.createShader(gl.FRAGMENT_SHADER)!;
        gl.shaderSource(fShader, compressCodeFile('./src/modules/player/webgl2/shaders/clarity-boost.fs') as any as string);
        gl.compileShader(fShader);

        // Create and link program
        const program = gl.createProgram()!;
        this.program = program;

        gl.attachShader(program, vShader);
        gl.attachShader(program, fShader);
        gl.linkProgram(program);
        gl.useProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error(`Link failed: ${gl.getProgramInfoLog(program)}`);
            console.error(`vs info-log: ${gl.getShaderInfoLog(vShader)}`);
            console.error(`fs info-log: ${gl.getShaderInfoLog(fShader)}`);
        }

        this.updateCanvas();

        // Vertices: A screen-filling quad made from two triangles
        const buffer = gl.createBuffer();
        this.resources.push(buffer);

        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1.0, -1.0, // Bottom-left
            3.0, -1.0,  // Bottom-right
            -1.0, 3.0,  // Top-left
        ]), gl.STATIC_DRAW);

        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

        // Texture to contain the video data
        const texture = gl.createTexture();
        this.resources.push(texture);

        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        // Bind texture to the "data" argument to the fragment shader
        gl.uniform1i(gl.getUniformLocation(program, 'data'), 0);

        gl.activeTexture(gl.TEXTURE0);
        // gl.bindTexture(gl.TEXTURE_2D, texture);
    }

    destroy() {
        super.destroy();

        this.destroyFsrResources();

        const gl = this.gl;
        if (!gl) {
            return;
        }

        gl.getExtension('WEBGL_lose_context')?.loseContext();
        gl.useProgram(null);

        for (const resource of this.resources) {
            if (resource instanceof WebGLProgram) {
                gl.deleteProgram(resource);
            } else if (resource instanceof WebGLShader) {
                gl.deleteShader(resource);
            } else if (resource instanceof WebGLTexture) {
                gl.deleteTexture(resource);
            } else if (resource instanceof WebGLBuffer) {
                gl.deleteBuffer(resource);
            }
        }

        this.gl = null;
    }

    refreshPlayer(): void {
        if (this.isFsr) {
            this.updateFsrCanvas();
        } else {
            this.updateCanvas();
        }
    }
}
