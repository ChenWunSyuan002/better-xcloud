import { GlobalPref, StreamPref, type AnyPref } from "@/enums/pref-keys";
import { limitVideoPlayerFps, onChangeVideoPlayerType, updateVideoPlayer } from "./stream/stream-settings-utils";
import { StreamStats } from "./stream/stream-stats";
import { SoundShortcut } from "./shortcuts/sound-shortcut";
import { STATES } from "@/utils/global";
import { getGamePref, getStreamPref, hasGamePref, isStreamPref, setGameIdPref, STORAGE } from "@/utils/pref-utils";
import { BxExposed } from "@/utils/bx-exposed";
import { StreamSettings } from "@/utils/stream-settings";
import { NativeMkbHandler } from "./mkb/native-mkb-handler";
import { BxEventBus } from "@/utils/bx-event-bus";
import { SettingElement } from "@/utils/setting-element";
import { CE } from "@/utils/html";
import { t } from "@/utils/translation";
import { BxSelectElement } from "@/web-components/bx-select";
import { XboxApi } from "@/utils/xbox-api";
import { EmulatedMkbHandler } from "./mkb/mkb-handler";

type SettingType = Partial<{
    hidden: true;
    onChange: () => void;
    onChangeUi: () => void;
    $element: HTMLElement;
}>;

export class SettingsManager {
    private static instance: SettingsManager;
    public static getInstance = () => SettingsManager.instance ?? (SettingsManager.instance = new SettingsManager());

    private $streamSettingsSelection!: HTMLElement;
    private $tips!: HTMLElement;
    private playingGameId: number = -1;
    private targetGameId: number = -1;

    // @ts-ignore
    private SETTINGS: Record<GlobalPref | StreamPref, SettingType> = {
        // [GlobalPref.VERSION_LATEST]: { hidden: true },
        // [GlobalPref.VERSION_LAST_CHECK]: { hidden: true },
        // [GlobalPref.VERSION_CURRENT]: { hidden: true },

        [StreamPref.LOCAL_CO_OP_ENABLED]: {
            onChange: () => {
                BxExposed.toggleLocalCoOp(getStreamPref(StreamPref.LOCAL_CO_OP_ENABLED));
            },
        },
        [StreamPref.DEVICE_VIBRATION_MODE]: {
            onChange: StreamSettings.refreshControllerSettings,
        },
        [StreamPref.DEVICE_VIBRATION_INTENSITY]: {
            onChange: StreamSettings.refreshControllerSettings,
        },
        [StreamPref.CONTROLLER_POLLING_RATE]: {
            onChange: StreamSettings.refreshControllerSettings,
        },
        [StreamPref.CONTROLLER_SETTINGS]: {
            onChange: StreamSettings.refreshControllerSettings,
        },
        [StreamPref.NATIVE_MKB_SCROLL_HORIZONTAL_SENSITIVITY]: {
            onChange: () => {
                const value = getStreamPref(StreamPref.NATIVE_MKB_SCROLL_HORIZONTAL_SENSITIVITY);
                NativeMkbHandler.getInstance()?.setHorizontalScrollMultiplier(value / 100);
            },
        },
        [StreamPref.NATIVE_MKB_SCROLL_VERTICAL_SENSITIVITY]: {
            onChange: () => {
                const value = getStreamPref(StreamPref.NATIVE_MKB_SCROLL_VERTICAL_SENSITIVITY);
                NativeMkbHandler.getInstance()?.setVerticalScrollMultiplier(value / 100);
            },
        },
        [StreamPref.VIDEO_PLAYER_TYPE]: {
            onChange: updateVideoPlayer,
            onChangeUi: onChangeVideoPlayerType,
        },
        [StreamPref.VIDEO_POWER_PREFERENCE]: {
            onChange: () => {
                const streamPlayer = STATES.currentStream.streamPlayerManager;
                if (!streamPlayer) {
                    return;
                }

                updateVideoPlayer();
            },
        },
        [StreamPref.VIDEO_PROCESSING]: {
            onChange: updateVideoPlayer,
            onChangeUi: onChangeVideoPlayerType,
        },
        [StreamPref.VIDEO_PROCESSING_MODE]: {
            onChange: updateVideoPlayer,
        },
        [StreamPref.VIDEO_SHARPNESS]: {
            onChange: updateVideoPlayer,
        },
        [StreamPref.VIDEO_FSR_RATIO]: {
            onChange: updateVideoPlayer,
            onChangeUi: onChangeVideoPlayerType,
        },
        [StreamPref.VIDEO_MAX_FPS]: {
            onChange: () => {
                const value = getStreamPref(StreamPref.VIDEO_MAX_FPS);
                limitVideoPlayerFps(value);
            },
        },
        [StreamPref.VIDEO_RATIO]: {
            onChange: updateVideoPlayer,
        },
        [StreamPref.VIDEO_BRIGHTNESS]: {
            onChange: updateVideoPlayer,
        },
        [StreamPref.VIDEO_CONTRAST]: {
            onChange: updateVideoPlayer,
        },
        [StreamPref.VIDEO_SATURATION]: {
            onChange: updateVideoPlayer,
        },
        [StreamPref.VIDEO_POSITION]: {
            onChange: updateVideoPlayer,
        },
        [StreamPref.AUDIO_VOLUME]: {
            onChange: () => {
                const value = getStreamPref(StreamPref.AUDIO_VOLUME);
                SoundShortcut.setGainNodeVolume(value);
            },
        },

        [StreamPref.STATS_ITEMS]: {
            onChange: StreamStats.refreshStyles,
        },
        [StreamPref.STATS_QUICK_GLANCE_ENABLED]: {
            onChange: () => {
                const value = getStreamPref(StreamPref.STATS_QUICK_GLANCE_ENABLED);
                if (!value) {
                    StreamStats.getInstance().stop(true);
                }
            },
        },
        [StreamPref.STATS_POSITION]: {
            onChange: StreamStats.refreshStyles,
        },
        [StreamPref.STATS_TEXT_SIZE]: {
            onChange: StreamStats.refreshStyles,
        },
        [StreamPref.STATS_OPACITY_ALL]: {
            onChange: StreamStats.refreshStyles,
        },
        [StreamPref.STATS_OPACITY_BACKGROUND]: {
            onChange: StreamStats.refreshStyles,
        },
        [StreamPref.STATS_CONDITIONAL_FORMATTING]: {
            onChange: StreamStats.refreshStyles,
        },

        [StreamPref.MKB_P1_MAPPING_PRESET_ID]: {
            onChange: StreamSettings.refreshMkbSettings,
        },

        [StreamPref.MKB_P1_SLOT]: {
            onChange: () => {
                EmulatedMkbHandler.getInstance()?.resetXcloudGamepads();
            },
        },

        [StreamPref.KEYBOARD_SHORTCUTS_IN_GAME_PRESET_ID]: {
            onChange: StreamSettings.refreshKeyboardShortcuts,
        },
    };

    constructor() {
        // Trigger onChange event when a setting value is modified
        BxEventBus.Stream.on('setting.changed', data => {
            if (isStreamPref(data.settingKey)) {
                this.updateStreamElement(data.settingKey);
            }
        });

        BxEventBus.Stream.on('gameSettings.switched', ({ id }) => {
            this.switchGameSettings(id);
        });

        this.renderStreamSettingsSelection();
    }

    private updateStreamElement(key: StreamPref, onChanges?: Set<SettingType['onChange']>, onChangeUis?: Set<SettingType['onChangeUi']>) {
        const info = this.SETTINGS[key];

        // Add events
        if (info.onChangeUi) {
            if (onChangeUis) {
                // Save to a Set()
                onChangeUis.add(info.onChangeUi);
            } else {
                // Trigger onChangeUi()
                info.onChangeUi();
            }
        }

        if (info.onChange && STATES.isPlaying) {
            if (onChanges) {
                // Save to a Set()
                onChanges.add(info.onChange);
            } else {
                // Trigger onChange()
                info.onChange();
            }
        }

        // Update element
        const $elm = info.$element;
        if (!$elm) {
            return;
        }

        const value = getGamePref(this.targetGameId, key, true)!;
        if ('setValue' in $elm) {
            ($elm as any).setValue(value);
        } else {
            ($elm as HTMLInputElement).value = value.toString();
        }

        this.updateDataset($elm, key as StreamPref);
    }

    private switchGameSettings(id: number) {
        setGameIdPref(id);

        // Don't re-apply settings if the game is the same
        if (this.targetGameId === id) {
            return;
        }

        // Re-apply all stream settings
        const onChanges: Set<SettingType['onChange']> = new Set();
        const onChangeUis: Set<SettingType['onChangeUi']> = new Set();
        const oldGameId = this.targetGameId;
        this.targetGameId = id;

        let key: AnyPref;
        for (key in this.SETTINGS) {
            if (!isStreamPref(key)) {
                continue;
            }

            const oldValue = getGamePref(oldGameId, key, true);
            const newValue = getGamePref(this.targetGameId, key, true);

            if (oldValue === newValue) {
                continue;
            }

            // Only apply Stream settings
            this.updateStreamElement(key, onChanges, onChangeUis);
        }

        // Trigger onChange callbacks
        onChangeUis.forEach(fn => fn && fn());
        onChanges.forEach(fn => fn && fn());

        // Toggle tips if not playing anything
        this.$tips.classList.toggle('bx-gone', id < 0);
    }

    setElement(pref: AnyPref, $elm: HTMLElement) {
        // Set empty object
        if (!this.SETTINGS[pref]) {
            this.SETTINGS[pref] = {};
        }

        this.updateDataset($elm, pref as StreamPref);
        this.SETTINGS[pref].$element = $elm;
    }

    getElement(pref: AnyPref, params?: any) {
        // Set empty object
        if (!this.SETTINGS[pref]) {
            this.SETTINGS[pref] = {};
        }

        let $elm = this.SETTINGS[pref].$element;

        if (!$elm) {
            // Render element
            $elm = SettingElement.fromPref(pref, null, params)!;
            this.SETTINGS[pref].$element = $elm;
        }

        this.updateDataset($elm, pref as StreamPref);
        return $elm;
    }

    hasElement(pref: AnyPref) {
        return !!this.SETTINGS[pref]?.$element;
    }

    private updateDataset($elm: HTMLElement, pref: StreamPref) {
        if (this.targetGameId === this.playingGameId && hasGamePref(this.playingGameId, pref)) {
            $elm.dataset.override = 'true';
        } else {
            delete $elm.dataset['override'];
        }
    }

    private renderStreamSettingsSelection() {
        this.$tips = CE('p', { class: 'bx-gone' }, `⇐ Ｑ ⟶: ${t('reset-highlighted-setting')}`);

        const $select = BxSelectElement.create(CE('select', false,
            CE('optgroup', { label: t('settings-for') },
                CE('option', { value: -1 }, t('all-games')),
            ),
        ), true);
        $select.addEventListener('input', e => {
            const id = parseInt($select.value);
            // $btn.disabled = id < 0;
            BxEventBus.Stream.emit('gameSettings.switched', { id });
        });

        this.$streamSettingsSelection = CE('div', {
                class: 'bx-stream-settings-selection bx-gone',
                _nearby: { orientation: 'vertical' },
            },
            CE('div', false, $select ),
            this.$tips,
        );

        BxEventBus.Stream.on('xboxTitleId.changed', async ({ id }) => {
            this.playingGameId = id;

            // Only switch to game settings if it's not empty
            const gameSettings = STORAGE.Stream.getGameSettings(id);
            const selectedId = (gameSettings && !gameSettings.isEmpty()) ? id : -1;

            setGameIdPref(selectedId);

            // Remove every options except the first one (All games)
            const $optGroup = $select.querySelector('optgroup')!;
            while ($optGroup.childElementCount > 1) {
                $optGroup.lastElementChild?.remove();
            }

            // Add current game to the selection
            if (id >= 0) {
                const title = id === 0 ? 'Xbox' : await XboxApi.getProductTitle(id);
                $optGroup.appendChild(CE('option', {
                    value: id,
                }, title));
            }

            // Activate custom settings

            $select.value = selectedId.toString();
            BxEventBus.Stream.emit('gameSettings.switched', { id: selectedId });
        });
    }

    getStreamSettingsSelection() {
        return this.$streamSettingsSelection;
    }

    getTargetGameId() {
        return this.targetGameId;
    }
}
