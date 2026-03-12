import type { FsrUpscaleRatio, StreamVideoProcessing, StreamVideoProcessingMode } from "@/enums/pref-values";

type StreamPlayerOptions = {
    processing: StreamVideoProcessing,
    processingMode: StreamVideoProcessingMode,
    sharpness: number,
    saturation: number,
    contrast: number,
    brightness: number,
    fsrRatio: FsrUpscaleRatio,
};
