import { STATES } from "@utils/global";
import { UserAgent } from "@utils/user-agent";
import { StreamPref } from "@/enums/pref-keys";
import { StreamVideoProcessing, StreamPlayerType } from "@/enums/pref-values";
import { getStreamPref, setStreamPref } from "@/utils/pref-utils";
import { SettingsManager } from "../settings-manager";
import type { StreamPlayerOptions } from "@/types/stream";

export function onChangeVideoPlayerType() {
    const playerType = getStreamPref(StreamPref.VIDEO_PLAYER_TYPE);
    const processing = getStreamPref(StreamPref.VIDEO_PROCESSING);
    const settingsManager = SettingsManager.getInstance();
    if (!settingsManager.hasElement(StreamPref.VIDEO_PROCESSING)) {
        return;
    }

    let isDisabled = false;

    const $videoProcessing = settingsManager.getElement(StreamPref.VIDEO_PROCESSING) as HTMLSelectElement;
    const $videoProcessingMode = settingsManager.getElement(StreamPref.VIDEO_PROCESSING_MODE) as HTMLSelectElement;
    const $videoSharpness = settingsManager.getElement(StreamPref.VIDEO_SHARPNESS);
    const $videoPowerPreference = settingsManager.getElement(StreamPref.VIDEO_POWER_PREFERENCE);
    const $videoMaxFps = settingsManager.getElement(StreamPref.VIDEO_MAX_FPS);
    const $videoFsrRatio = settingsManager.getElement(StreamPref.VIDEO_FSR_RATIO);

    const $optCas = $videoProcessing.querySelector<HTMLOptionElement>(`option[value=${StreamVideoProcessing.CAS}]`);
    const $optFsr = $videoProcessing.querySelector<HTMLOptionElement>(`option[value=${StreamVideoProcessing.FSR}]`);

    const isFsr = processing === StreamVideoProcessing.FSR;

    if (playerType === StreamPlayerType.VIDEO) {
        // Only allow USM when player type is Video
        $videoProcessing.value = StreamVideoProcessing.USM;
        setStreamPref(StreamPref.VIDEO_PROCESSING, StreamVideoProcessing.USM, 'direct');

        $optCas && ($optCas.disabled = true);
        $optFsr && ($optFsr.disabled = true);

        if (UserAgent.isSafari()) {
            isDisabled = true;
        }
    } else {
        $optCas && ($optCas.disabled = false);
        $optFsr && ($optFsr.disabled = false);
    }

    $videoProcessing.disabled = isDisabled;
    $videoSharpness.dataset.disabled = isDisabled.toString();

    // Hide Processing Mode when FSR is selected or when not WebGL2+CAS
    $videoProcessingMode.closest('.bx-settings-row')!.classList.toggle('bx-gone', isFsr || !(playerType === StreamPlayerType.WEBGL2 && processing === StreamVideoProcessing.CAS));
    // Show FSR Ratio only when FSR is selected
    $videoFsrRatio.closest('.bx-settings-row')!.classList.toggle('bx-gone', !isFsr);
    $videoPowerPreference.closest('.bx-settings-row')!.classList.toggle('bx-gone', playerType !== StreamPlayerType.WEBGL2);
    $videoMaxFps.closest('.bx-settings-row')!.classList.toggle('bx-gone', playerType === StreamPlayerType.VIDEO);
}


export function limitVideoPlayerFps(targetFps: number) {
    const streamPlayer = STATES.currentStream.streamPlayerManager;
    streamPlayer?.getCanvasPlayer()?.setTargetFps(targetFps);
}


export function updateVideoPlayer() {
    const streamPlayerManager = STATES.currentStream.streamPlayerManager;
    if (!streamPlayerManager) {
        return;
    }

    const options = {
        processing: getStreamPref(StreamPref.VIDEO_PROCESSING),
        processingMode: getStreamPref(StreamPref.VIDEO_PROCESSING_MODE),
        sharpness: getStreamPref(StreamPref.VIDEO_SHARPNESS),
        saturation: getStreamPref(StreamPref.VIDEO_SATURATION),
        contrast: getStreamPref(StreamPref.VIDEO_CONTRAST),
        brightness: getStreamPref(StreamPref.VIDEO_BRIGHTNESS),
        fsrRatio: getStreamPref(StreamPref.VIDEO_FSR_RATIO),
    } satisfies StreamPlayerOptions;

    streamPlayerManager.switchPlayerType(getStreamPref(StreamPref.VIDEO_PLAYER_TYPE));
    limitVideoPlayerFps(getStreamPref(StreamPref.VIDEO_MAX_FPS));
    streamPlayerManager.updateOptions(options);
    streamPlayerManager.refreshPlayer();
}

function resizeVideoPlayer() {
    const streamPlayerManager = STATES.currentStream.streamPlayerManager;
    streamPlayerManager?.resizePlayer();
}

window.addEventListener('resize', resizeVideoPlayer);
