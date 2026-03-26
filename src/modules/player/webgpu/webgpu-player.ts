import { compressCodeFile } from "@macros/build" with { type: "macro" };

import { BaseCanvasPlayer } from "../base-canvas-player";
import { FsrUpscaleRatio, StreamPlayerType, StreamVideoProcessing } from "@/enums/pref-values";
import { BxEventBus } from "@/utils/bx-event-bus";
import { BX_FLAGS } from "@/utils/bx-flags";

export class WebGPUPlayer extends BaseCanvasPlayer {
    static device: GPUDevice;

    context!: GPUCanvasContext | null;
    pipeline!: GPURenderPipeline | null;
    sampler!: GPUSampler | null;
    bindGroup!: GPUBindGroup | null;
    optionsUpdated: boolean = false;
    paramsBuffer!: GPUBuffer | null;
    vertexBuffer!: GPUBuffer | null;

    // FSR resources
    private easuPipeline: GPURenderPipeline | null = null;
    private rcasPipeline: GPURenderPipeline | null = null;
    private intermediateTexture: GPUTexture | null = null;
    private intermediateTextureView: GPUTextureView | null = null;
    private easuParamsBuffer: GPUBuffer | null = null;
    private rcasParamsBuffer: GPUBuffer | null = null;
    private easuBindGroup: GPUBindGroup | null = null;
    private rcasBindGroup: GPUBindGroup | null = null;
    private isFsr = false;

    static async prepare(): Promise<void> {
        if (!BX_FLAGS.EnableWebGPURenderer || !navigator.gpu) {
            BxEventBus.Script.emit('webgpu.ready', {});
            return;
        }

        try {
            const adapter = await navigator.gpu.requestAdapter();

            if (adapter) {
                WebGPUPlayer.device = await adapter.requestDevice();
                WebGPUPlayer.device?.addEventListener('uncapturederror', e => {
                    console.error((e as GPUUncapturedErrorEvent).error.message);
                });
            }
        } catch (ex) {
            alert(ex);
        }

        BxEventBus.Script.emit('webgpu.ready', {});
    }

    constructor($video: HTMLVideoElement) {
        super(StreamPlayerType.WEBGPU, $video, 'WebGPUPlayer');
    }

    protected setupShaders(): void {
        this.isFsr = this.options.processing === StreamVideoProcessing.FSR;

        if (this.isFsr) {
            this.setupFsrShaders();
            return;
        }

        this.context = this.$canvas.getContext('webgpu')!;
        if (!this.context) {
            alert('Can\'t initiate context');
            return;
        }

        const format = navigator.gpu.getPreferredCanvasFormat();
        this.context.configure({
            device: WebGPUPlayer.device,
            format,
            alphaMode: 'opaque',
        });

        this.vertexBuffer = WebGPUPlayer.device.createBuffer({
            label: 'vertex buffer',
            size: 6 * 4, // 6 floats (2 per vertex)
            usage: GPUBufferUsage.VERTEX,
            mappedAtCreation: true,
        });

        const mappedRange = this.vertexBuffer.getMappedRange();
        new Float32Array(mappedRange).set([
            -1, 3,  // Vertex 1
            -1, -1, // Vertex 2
            3, -1,  // Vertex 3
        ]);
        this.vertexBuffer.unmap();

        const shaderModule = WebGPUPlayer.device.createShaderModule({ code: compressCodeFile('./src/modules/player/webgpu/shaders/clarity-boost.wgsl') as any as string });
        this.pipeline = WebGPUPlayer.device.createRenderPipeline({
            layout: 'auto',
            vertex: {
                module: shaderModule,
                entryPoint: 'vsMain',
                buffers: [{
                    arrayStride: 8,
                    attributes: [{
                        format: 'float32x2',
                        offset: 0,
                        shaderLocation: 0,
                    }],
                }],
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fsMain',
                targets: [{ format }],
            },
            primitive: { topology: 'triangle-list' },
        });

        this.sampler = WebGPUPlayer.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
        this.updateCanvas();
    }

    private prepareUniformBuffer(value: any, classType: any) {
        const uniform = new classType(value);
        const uniformBuffer = WebGPUPlayer.device.createBuffer({
            size: uniform.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        WebGPUPlayer.device.queue.writeBuffer(uniformBuffer, 0, uniform);
        return uniformBuffer;
    }

    private updateCanvas() {
        const externalTexture = WebGPUPlayer.device.importExternalTexture({ source: this.$video });

        if (!this.optionsUpdated) {
            this.paramsBuffer = this.prepareUniformBuffer([
                this.toFilterId(this.options.processing),
                this.options.sharpness,
                this.options.brightness / 100,
                this.options.contrast / 100,
                this.options.saturation / 100,
            ], Float32Array);

            this.optionsUpdated = true;
        }

        this.bindGroup = WebGPUPlayer.device.createBindGroup({
            layout: this.pipeline!.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: this.sampler },
                { binding: 1, resource: externalTexture as any },
                { binding: 2, resource: { buffer: this.paramsBuffer } },
            ],
        });
    }

    updateFrame(): void {
        if (this.isFsr) {
            this.updateFsrFrame();
            return;
        }

        this.updateCanvas();

        const commandEncoder = WebGPUPlayer.device.createCommandEncoder();
        const passEncoder = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: this.context!.getCurrentTexture().createView(),
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: [0.0, 0.0, 0.0, 1.0],
            }]
        });

        passEncoder.setPipeline(this.pipeline!);
        passEncoder.setBindGroup(0, this.bindGroup);
        passEncoder.setVertexBuffer(0, this.vertexBuffer);
        passEncoder.draw(3);
        passEncoder.end();

        WebGPUPlayer.device.queue.submit([commandEncoder.finish()]);
    }

    refreshPlayer(): void {
        if (this.isFsr) {
            this.optionsUpdated = false;
            this.updateFsrCanvas();
        } else {
            this.optionsUpdated = false;
            this.updateCanvas();
        }
    }

    destroy(): void {
        super.destroy();

        this.destroyFsrResources();

        this.isStopped = true;

        // Unset GPU resources
        this.pipeline = null;
        this.bindGroup = null;
        this.sampler = null;

        this.paramsBuffer?.destroy();
        this.paramsBuffer = null;

        this.vertexBuffer?.destroy();
        this.vertexBuffer = null;

        // Reset the WebGPU context (force garbage collection)
        if (this.context) {
            this.context.unconfigure();
            this.context = null;
        }

        console.log('WebGPU context successfully freed.');
    }

    // --- FSR Methods ---

    private calculateCanvasSize(): { width: number, height: number } {
        const videoWidth = this.$video.videoWidth;
        const videoHeight = this.$video.videoHeight;
        const ratio = this.options.fsrRatio;
        const maxSize = WebGPUPlayer.device.limits.maxTextureDimension2D;

        if (ratio === FsrUpscaleRatio.AUTO) {
            const screenWidth = window.innerWidth * window.devicePixelRatio;
            const screenHeight = window.innerHeight * window.devicePixelRatio;
            const videoRatio = videoWidth / videoHeight;

            let w, h;
            if (screenWidth / screenHeight > videoRatio) {
                h = screenHeight;
                w = Math.round(h * videoRatio);
            } else {
                w = screenWidth;
                h = Math.round(w / videoRatio);
            }

            return {
                width: Math.min(Math.max(w, videoWidth), maxSize),
                height: Math.min(Math.max(h, videoHeight), maxSize),
            };
        }

        const multiplier = parseFloat(ratio.substring(1));
        return {
            width: Math.min(Math.round(videoWidth * multiplier), maxSize),
            height: Math.min(Math.round(videoHeight * multiplier), maxSize),
        };
    }

    private setupFsrShaders() {
        this.context = this.$canvas.getContext('webgpu')!;
        if (!this.context) {
            alert('Can\'t initiate context');
            return;
        }

        const format = navigator.gpu.getPreferredCanvasFormat();
        this.context.configure({
            device: WebGPUPlayer.device,
            format,
            alphaMode: 'opaque',
        });

        // Calculate canvas size for FSR
        const canvasSize = this.calculateCanvasSize();
        this.$canvas.width = canvasSize.width;
        this.$canvas.height = canvasSize.height;

        // Create vertex buffer (shared by both pipelines)
        this.vertexBuffer = WebGPUPlayer.device.createBuffer({
            label: 'vertex buffer',
            size: 6 * 4,
            usage: GPUBufferUsage.VERTEX,
            mappedAtCreation: true,
        });
        new Float32Array(this.vertexBuffer.getMappedRange()).set([-1, 3, -1, -1, 3, -1]);
        this.vertexBuffer.unmap();

        const vertexBufferLayout: GPUVertexBufferLayout = {
            arrayStride: 8,
            attributes: [{ format: 'float32x2' as GPUVertexFormat, offset: 0, shaderLocation: 0 }],
        };

        // Create EASU pipeline
        const easuModule = WebGPUPlayer.device.createShaderModule({
            code: compressCodeFile('./src/modules/player/webgpu/shaders/fsr-easu.wgsl') as any as string,
        });
        this.easuPipeline = WebGPUPlayer.device.createRenderPipeline({
            layout: 'auto',
            vertex: { module: easuModule, entryPoint: 'vsMain', buffers: [vertexBufferLayout] },
            fragment: { module: easuModule, entryPoint: 'fsMain', targets: [{ format }] },
            primitive: { topology: 'triangle-list' },
        });

        // Create RCAS pipeline
        const rcasModule = WebGPUPlayer.device.createShaderModule({
            code: compressCodeFile('./src/modules/player/webgpu/shaders/fsr-rcas.wgsl') as any as string,
        });
        this.rcasPipeline = WebGPUPlayer.device.createRenderPipeline({
            layout: 'auto',
            vertex: { module: rcasModule, entryPoint: 'vsMain', buffers: [vertexBufferLayout] },
            fragment: { module: rcasModule, entryPoint: 'fsMain', targets: [{ format }] },
            primitive: { topology: 'triangle-list' },
        });

        // Create intermediate texture (EASU output / RCAS input)
        this.intermediateTexture = WebGPUPlayer.device.createTexture({
            size: [canvasSize.width, canvasSize.height],
            format,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
        this.intermediateTextureView = this.intermediateTexture.createView();

        // Create sampler (shared by both pipelines)
        this.sampler = WebGPUPlayer.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

        // Create EASU params buffer (output resolution)
        this.easuParamsBuffer = this.prepareUniformBuffer(
            [canvasSize.width, canvasSize.height],
            Float32Array,
        );

        // Create RCAS params and bind group
        this.updateFsrOptions();
    }

    private updateFsrOptions() {
        this.rcasParamsBuffer?.destroy();
        this.rcasParamsBuffer = this.prepareUniformBuffer([
            this.$canvas.width, this.$canvas.height,
            (10 - this.options.sharpness) / 5,
            this.options.brightness / 100,
            this.options.contrast / 100,
            this.options.saturation / 100,
        ], Float32Array);

        // RCAS bind group is stable (intermediate texture doesn't change per frame)
        this.rcasBindGroup = WebGPUPlayer.device.createBindGroup({
            layout: this.rcasPipeline!.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: this.sampler! },
                { binding: 1, resource: this.intermediateTextureView! },
                { binding: 2, resource: { buffer: this.rcasParamsBuffer } },
            ],
        });

        this.optionsUpdated = true;
    }

    private updateFsrCanvas() {
        // Import video as external texture (changes every frame)
        const externalTexture = WebGPUPlayer.device.importExternalTexture({ source: this.$video });

        if (!this.optionsUpdated) {
            this.updateFsrOptions();
        }

        // Recreate EASU bind group every frame (external texture changes)
        this.easuBindGroup = WebGPUPlayer.device.createBindGroup({
            layout: this.easuPipeline!.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: this.sampler! },
                { binding: 1, resource: externalTexture as any },
                { binding: 2, resource: { buffer: this.easuParamsBuffer! } },
            ],
        });
    }

    private updateFsrFrame() {
        this.updateFsrCanvas();

        const commandEncoder = WebGPUPlayer.device.createCommandEncoder();

        // Pass 1: EASU - render video to intermediate texture
        const easuPass = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: this.intermediateTextureView!,
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: [0.0, 0.0, 0.0, 1.0],
            }],
        });
        easuPass.setPipeline(this.easuPipeline!);
        easuPass.setBindGroup(0, this.easuBindGroup);
        easuPass.setVertexBuffer(0, this.vertexBuffer);
        easuPass.draw(3);
        easuPass.end();

        // Pass 2: RCAS - render intermediate texture to screen
        const rcasPass = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: this.context!.getCurrentTexture().createView(),
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: [0.0, 0.0, 0.0, 1.0],
            }],
        });
        rcasPass.setPipeline(this.rcasPipeline!);
        rcasPass.setBindGroup(0, this.rcasBindGroup);
        rcasPass.setVertexBuffer(0, this.vertexBuffer);
        rcasPass.draw(3);
        rcasPass.end();

        WebGPUPlayer.device.queue.submit([commandEncoder.finish()]);
    }

    private destroyFsrResources() {
        this.intermediateTexture?.destroy();
        this.intermediateTexture = null;
        this.intermediateTextureView = null;

        this.easuParamsBuffer?.destroy();
        this.easuParamsBuffer = null;

        this.rcasParamsBuffer?.destroy();
        this.rcasParamsBuffer = null;

        this.easuPipeline = null;
        this.rcasPipeline = null;
        this.easuBindGroup = null;
        this.rcasBindGroup = null;
    }
}
