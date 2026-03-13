import { WebGL2Player } from "./player/webgl2/webgl2-player";
import { ScreenshotManager } from "@/utils/screenshot-manager";
import { STATES } from "@/utils/global";
import { StreamPref } from "@/enums/pref-keys";
import { BX_FLAGS } from "@/utils/bx-flags";
import { StreamPlayerType, StreamVideoProcessing, VideoPosition } from "@/enums/pref-values";
import { getStreamPref } from "@/utils/pref-utils";
import type { BaseCanvasPlayer } from "./player/base-canvas-player";
import { VideoPlayer } from "./player/video/video-player";
import { StreamPlayerElement } from "./player/base-stream-player";
import { WebGPUPlayer } from "./player/webgpu/webgpu-player";
import type { StreamPlayerOptions } from "@/types/stream";


export class StreamPlayerManager {
    private static instance: StreamPlayerManager;
    public static getInstance = () => StreamPlayerManager.instance ?? (StreamPlayerManager.instance = new StreamPlayerManager());

    private $video!: HTMLVideoElement;
    private videoPlayer!: VideoPlayer;
    private canvasPlayer: BaseCanvasPlayer | null | undefined;
    private playerType: StreamPlayerType = StreamPlayerType.VIDEO;
    private currentProcessing?: StreamVideoProcessing;
    private currentFsrRatio?: string;

    private constructor() {}

    setVideoElement($video: HTMLVideoElement) {
        this.$video = $video;
        this.videoPlayer = new VideoPlayer($video, 'VideoPlayer');
        this.videoPlayer.init();
    }

    resizePlayer() {
        const PREF_RATIO = getStreamPref(StreamPref.VIDEO_RATIO);
        const $video = this.$video;
        const isNativeTouchGame = STATES.currentStream.titleInfo?.details.hasNativeTouchSupport;

        let targetWidth;
        let targetHeight;
        let targetObjectFit;

        if (PREF_RATIO.includes(':')) {
            const tmp = PREF_RATIO.split(':');

            // Get preferred ratio
            const videoRatio = parseFloat(tmp[0]) / parseFloat(tmp[1]);

            let width = 0;
            let height = 0;

            // Get parent's ratio
            const parentRect = $video.parentElement!.getBoundingClientRect();
            const parentRatio = parentRect.width / parentRect.height;

            // Get target width & height
            if (parentRatio > videoRatio) {
                height = parentRect.height;
                width = height * videoRatio;
            } else {
                width = parentRect.width;
                height = width / videoRatio;
            }

            // Avoid floating points
            width = Math.ceil(Math.min(parentRect.width, width));
            height = Math.ceil(Math.min(parentRect.height, height));

            $video.dataset.width = width.toString();
            $video.dataset.height = height.toString();

            // Set position
            const $parent = $video.parentElement!;
            const position = getStreamPref(StreamPref.VIDEO_POSITION);
            $parent.style.removeProperty('padding-top');

            $parent.dataset.position = position;
            if (position === VideoPosition.TOP_HALF || position === VideoPosition.BOTTOM_HALF) {
                let padding = Math.floor((window.innerHeight - height) / 4);
                if (padding > 0) {
                    if (position === VideoPosition.BOTTOM_HALF) {
                        padding *= 3;
                    }

                    $parent.style.paddingTop = padding + 'px';
                }
            }

            // Update size
            targetWidth = `${width}px`;
            targetHeight = `${height}px`;
            targetObjectFit = PREF_RATIO === '16:9' ? 'contain' : 'fill';
        } else {
            targetWidth = '100%';
            targetHeight = '100%';
            targetObjectFit = PREF_RATIO;

            $video.dataset.width = window.innerWidth.toString();
            $video.dataset.height = window.innerHeight.toString();
        }

        $video.style.width = targetWidth;
        $video.style.height = targetHeight;
        $video.style.objectFit = targetObjectFit;

        if (this.canvasPlayer) {
            const $canvas = this.canvasPlayer.getCanvas();
            $canvas.style.width = targetWidth;
            $canvas.style.height = targetHeight;
            $canvas.style.objectFit = targetObjectFit;

            $video.dispatchEvent(new Event('resize'));
        }

        // Update video dimensions
        if (isNativeTouchGame && this.playerType !== StreamPlayerType.VIDEO) {
            window.BX_EXPOSED.streamSession.updateDimensions();
        }
    }

    switchPlayerType(type: StreamPlayerType, refreshPlayer: boolean = false) {
        if (this.playerType !== type) {
            const videoClass = BX_FLAGS.DeviceInfo.deviceType === 'android-tv' ? 'bx-pixel' : 'bx-gone';

            // Destroy old player
            this.cleanUpCanvasPlayer();
            this.currentProcessing = undefined;
            this.currentFsrRatio = undefined;

            if (type === StreamPlayerType.VIDEO) {
                // Switch from Canvas -> Video
                this.$video.classList.remove(videoClass);
            } else {
                // Switch from Video -> Canvas
                if (BX_FLAGS.EnableWebGPURenderer && type === StreamPlayerType.WEBGPU) {
                    this.canvasPlayer = new WebGPUPlayer(this.$video);
                } else {
                    this.canvasPlayer = new WebGL2Player(this.$video);
                }
                this.canvasPlayer.init();

                this.videoPlayer.clearFilters();
                this.$video.classList.add(videoClass);
            }

            this.playerType = type;
        }

        refreshPlayer && this.refreshPlayer();
    }

    updateOptions(options: StreamPlayerOptions, refreshPlayer: boolean = false) {
        // FSR uses a completely different shader pipeline (two-pass),
        // so switching to/from FSR or changing FSR ratio requires recreating the canvas player.
        const needsRecreate = this.canvasPlayer && (
            (options.processing !== this.currentProcessing &&
             (options.processing === StreamVideoProcessing.FSR || this.currentProcessing === StreamVideoProcessing.FSR)) ||
            (options.processing === StreamVideoProcessing.FSR && options.fsrRatio !== this.currentFsrRatio)
        );

        this.currentProcessing = options.processing;
        this.currentFsrRatio = options.fsrRatio;

        if (needsRecreate) {
            this.cleanUpCanvasPlayer();

            if (BX_FLAGS.EnableWebGPURenderer && this.playerType === StreamPlayerType.WEBGPU) {
                this.canvasPlayer = new WebGPUPlayer(this.$video);
            } else {
                this.canvasPlayer = new WebGL2Player(this.$video);
            }
            this.canvasPlayer.updateOptions(options);
            this.canvasPlayer.init();
        } else {
            (this.canvasPlayer || this.videoPlayer).updateOptions(options, refreshPlayer);
        }
    }

    getPlayerElement(elementType?: StreamPlayerElement) {
        if (typeof elementType === 'undefined') {
            elementType = this.playerType === StreamPlayerType.VIDEO ? StreamPlayerElement.VIDEO : StreamPlayerElement.CANVAS;
        }

        if (elementType !== StreamPlayerElement.VIDEO) {
            return this.canvasPlayer?.getCanvas();
        }

        return this.$video;
    }

    getCanvasPlayer() {
        return this.canvasPlayer;
    }

    refreshPlayer() {
        if (this.playerType === StreamPlayerType.VIDEO) {
            this.videoPlayer.refreshPlayer();
        } else {
            ScreenshotManager.getInstance().updateCanvasFilters('none');
            this.canvasPlayer?.refreshPlayer();
        }

        this.resizePlayer();
    }

    getVideoPlayerFilterStyle() {
        throw new Error("Method not implemented.");
    }

    private cleanUpCanvasPlayer() {
        this.canvasPlayer?.destroy();
        this.canvasPlayer = null;
    }

    destroy() {
        this.cleanUpCanvasPlayer();
    }
}
