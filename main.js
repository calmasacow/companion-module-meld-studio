import { InstanceBase, InstanceStatus, runEntrypoint } from '@companion-module/base'
import WebSocket from 'ws'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import vm from 'vm'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

class MeldStudioInstance extends InstanceBase {
  constructor(internal) {
    super(internal)
    this.ws = null
    this.transport = null
    this.meld = null
    this.sessionItems = {}

    this._isStreaming = false
    this._isRecording = false
  }

  getConfigFields() {
    return [
      { type: 'textinput', id: 'host', label: 'Meld Host', width: 6, default: '127.0.0.1' },
      { type: 'number', id: 'port', label: 'WebChannel Port', width: 4, default: 13376, min: 1, max: 65535 },
    ]
  }

  async init(config) {
    this.config = config || {}
    if (!this.config.host) this.config.host = '127.0.0.1'
    if (!this.config.port) this.config.port = 13376

    // Load vendor/qwebchannel.js via VM and expose constructor globally
    try {
      const qwcPath = path.join(__dirname, 'vendor', 'qwebchannel.js')
      const code = fs.readFileSync(qwcPath, 'utf8')
      const sandbox = { module: { exports: {} }, exports: {}, window: {}, self: {}, global: {}, console }
      vm.createContext(sandbox)
      new vm.Script(code, { filename: 'qwebchannel.js' }).runInContext(sandbox)
      const QWC =
        sandbox.module?.exports?.QWebChannel ||
        sandbox.exports?.QWebChannel ||
        sandbox.window?.QWebChannel ||
        sandbox.self?.QWebChannel ||
        sandbox.global?.QWebChannel ||
        sandbox.QWebChannel
      if (typeof QWC !== 'function') throw new Error('QWebChannel export not found or not a function')
      globalThis.QWebChannel = QWC
    } catch (e) {
      this.updateStatus(InstanceStatus.Error, 'Failed to load vendor/qwebchannel.js')
      this.log('error', `Load qwebchannel.js failed: ${e.message}`)
      return
    }

    this._initVariables()
    this._initFeedbacks()
    this._initActions()
    this._connect()
  }

  async configUpdated(config) {
    this.config = config || this.config
    this._disconnect()
    this._connect()
  }

  async destroy() {
    this._disconnect()
  }

  // ---------- helpers ----------
  _getSceneChoices() {
    const items = this.sessionItems || {}
    const out = []
    for (const [id, obj] of Object.entries(items)) {
      if (obj && obj.type === 'scene') {
        const label = obj.name ? `${obj.name} (${id.slice(0, 8)})` : id
        out.push({ id, label, index: obj.index ?? 9999 })
      }
    }
    out.sort((a, b) => (a.index === b.index ? a.label.localeCompare(b.label) : a.index - b.index))
    return out.map(({ id, label }) => ({ id, label }))
  }

  _getCurrentSceneId() {
    for (const [id, obj] of Object.entries(this.sessionItems || {})) {
      if (obj?.type === 'scene' && obj.current) return id
    }
    return ''
  }

  _getSceneNameById(id) {
    const obj = (this.sessionItems || {})[id]
    return obj?.type === 'scene' ? (obj.name || id) : id
  }

  _getCurrentSceneName() {
    const id = this._getCurrentSceneId()
    return this._getSceneNameById(id)
  }

  _refreshActionChoices() {
    this._initActions()
    // refresh feedback dropdowns & presets too
    this._initFeedbacks()
    this._refreshPresets()
    this.checkFeedbacks('labelSceneName', 'sceneIsLive')
  }

  _initVariables() {
    this.setVariableDefinitions([
      { variableId: 'current_scene_name', name: 'Current Scene Name' },
      { variableId: 'is_streaming', name: 'Streaming status (ON/OFF)' },
      { variableId: 'is_recording', name: 'Recording status (ON/OFF)' },
    ])
    this.setVariableValues({
      current_scene_name: '',
      is_streaming: 'OFF',
      is_recording: 'OFF',
    })
  }

  _updateVariables() {
    this.setVariableValues({
      current_scene_name: this._getCurrentSceneName() || '',
      is_streaming: this._isStreaming ? 'ON' : 'OFF',
      is_recording: this._isRecording ? 'ON' : 'OFF',
    })
  }

  _initFeedbacks() {
    const sceneChoices = this._getSceneChoices()

    this.setFeedbackDefinitions({
      // Advanced feedback that writes button text to chosen scene name
      // and returns a full style every time (no Companion fallback blue).
      labelSceneName: {
        name: 'Label: Scene Name (from dropdown)',
        type: 'advanced',
        description: 'Sets button text to the selected scene name. Optionally highlight if that scene is live.',
        options: [
          { type: 'dropdown', id: 'sceneId', label: 'Scene', choices: sceneChoices, default: sceneChoices[0]?.id ?? '', allowCustom: true },
          { type: 'checkbox', id: 'highlightLive', label: 'Highlight when scene is live', default: true },
          { type: 'colorpicker', id: 'idleBg', label: 'Background when NOT live', default: 0x000000 },
          { type: 'colorpicker', id: 'idleFg', label: 'Text color when NOT live', default: 0xffffff },
          { type: 'colorpicker', id: 'liveBg', label: 'Background when LIVE', default: 0xcc0000 },
          { type: 'colorpicker', id: 'liveFg', label: 'Text color when LIVE', default: 0xffffff },
        ],
        callback: (fb) => {
          const sceneId = fb.options?.sceneId || ''
          if (!sceneId) return null
          const name = this._getSceneNameById(sceneId) || sceneId
          const isLive = this._getCurrentSceneId() === sceneId
          if (fb.options?.highlightLive && isLive) {
            return { text: name, bgcolor: fb.options.liveBg ?? 0xcc0000, color: fb.options.liveFg ?? 0xffffff }
          } else {
            return { text: name, bgcolor: fb.options.idleBg ?? 0x000000, color: fb.options.idleFg ?? 0xffffff }
          }
        },
      },

      recordingOn: {
        name: 'Recording is ON',
        type: 'boolean',
        description: 'True when Meld is recording',
        defaultStyle: { bgcolor: 0xff0000, color: 0xffffff },
        options: [],
        callback: () => this._isRecording === true,
      },

      streamingOn: {
        name: 'Streaming is ON',
        type: 'boolean',
        description: 'True when Meld is streaming',
        defaultStyle: { bgcolor: 0x00aa00, color: 0xffffff },
        options: [],
        callback: () => this._isStreaming === true,
      },

      // Boolean feedback that turns red when selected scene is live
      sceneIsLive: {
        name: 'Scene is Live',
        type: 'boolean',
        description: 'True when the selected scene is currently live',
        defaultStyle: { bgcolor: 0xcc0000, color: 0xffffff },
        options: [
          { type: 'dropdown', id: 'sceneId', label: 'Scene', choices: sceneChoices, default: sceneChoices[0]?.id ?? '', allowCustom: true },
        ],
        callback: (fb) => {
          const targetId = fb.options?.sceneId || ''
          const currentId = this._getCurrentSceneId()
          return targetId && currentId && targetId === currentId
        },
      },
    })
  }

  // ---------- PRESETS ----------
  _initPresets() {
    const presets = []
    const scenes = []

    for (const [id, obj] of Object.entries(this.sessionItems || {})) {
      if (obj?.type === 'scene') scenes.push({ id, name: obj.name || id, index: obj.index ?? 9999 })
    }
    scenes.sort((a, b) => (a.index === b.index ? a.name.localeCompare(b.name) : a.index - b.index))

    // One preset per scene
    for (const sc of scenes) {
      presets.push({
        type: 'button',
        category: 'Meld Studio / Scenes',
        name: `Scene: ${sc.name}`,
        style: { text: sc.name, size: 'auto', color: 0xffffff, bgcolor: 0x000000 },
        steps: [
          {
            down: [{ actionId: 'showScene', options: { sceneId: sc.id } }],
            up: [],
          },
        ],
        feedbacks: [
          // Red when that scene is live
          { feedbackId: 'sceneIsLive', options: { sceneId: sc.id }, style: { bgcolor: 0xcc0000, color: 0xffffff } },
          // Label with consistent colors, highlight when live
          {
            feedbackId: 'labelSceneName',
            options: {
              sceneId: sc.id,
              highlightLive: true,
              idleBg: 0x000000,
              idleFg: 0xffffff,
              liveBg: 0xcc0000,
              liveFg: 0xffffff,
            },
          },
        ],
      })
    }

    // Utility presets
    presets.push(
      {
        type: 'button',
        category: 'Meld Studio / Utility',
        name: 'Toggle Recording',
        style: { text: 'REC', size: 'auto', color: 0xffffff, bgcolor: 0x000000 },
        steps: [{ down: [{ actionId: 'toggleRecord', options: {} }], up: [] }],
        feedbacks: [{ feedbackId: 'recordingOn', style: { bgcolor: 0xff0000, color: 0xffffff } }],
      },
      {
        type: 'button',
        category: 'Meld Studio / Utility',
        name: 'Toggle Streaming',
        style: { text: 'STREAM', size: 'auto', color: 0xffffff, bgcolor: 0x000000 },
        steps: [{ down: [{ actionId: 'toggleStream', options: {} }], up: [] }],
        feedbacks: [{ feedbackId: 'streamingOn', style: { bgcolor: 0x00aa00, color: 0xffffff } }],
      }
    )

    this.setPresetDefinitions(presets)
  }

  _refreshPresets() {
    this._initPresets()
  }
  // -------------------------------------------

  _connect() {
    const url = `ws://${this.config.host}:${this.config.port}`
    this.updateStatus(InstanceStatus.Connecting)
    this.log('info', `Connecting to Meld: ${url}`)

    this.ws = new WebSocket(url)

    // Qt-style transport wrapper for QWebChannel
    this.transport = {
      onmessage: null,
      send: (data) => {
        try {
          if (typeof data !== 'string') data = JSON.stringify(data)
          this.ws.send(data)
        } catch (e) {
          this.log('error', `Transport send failed: ${e.message}`)
        }
      },
    }

    this.ws.on('open', () => {
      this.ws.on('message', (frame) => {
        const data = typeof frame === 'string' ? frame : frame.toString('utf8')
        if (typeof this.transport.onmessage === 'function') this.transport.onmessage({ data })
      })

      // eslint-disable-next-line no-undef
      const QWC = globalThis.QWebChannel
      // eslint-disable-next-line no-new
      new QWC(this.transport, (channel) => {
        this.meld = channel.objects.meld
        this.log('info', 'Meld WebChannel ready')

        // Seed state
        try {
          this.sessionItems = this.meld.session?.items || {}
        } catch {
          this.sessionItems = {}
        }
        try {
          this._isStreaming = !!this.meld.isStreaming
          this._isRecording = !!this.meld.isRecording
        } catch {}

        // Update UI bits
        this._updateVariables()
        this._refreshActionChoices()
        this._initPresets()
        this.checkFeedbacks('labelSceneName', 'sceneIsLive', 'recordingOn', 'streamingOn')

        // Signals
        this.meld.sessionChanged.connect(() => {
          try {
            this.sessionItems = this.meld.session.items || {}
          } catch {
            this.sessionItems = {}
          }
          this._updateVariables()
          this._refreshActionChoices()
          this._refreshPresets()
          this.checkFeedbacks('labelSceneName', 'sceneIsLive')
        })

        this.meld.isStreamingChanged.connect(() => {
          this._isStreaming = !!this.meld.isStreaming
          this._updateVariables()
          this.checkFeedbacks('streamingOn')
        })

        this.meld.isRecordingChanged.connect(() => {
          this._isRecording = !!this.meld.isRecording
          this._updateVariables()
          this.checkFeedbacks('recordingOn')
        })

        this.meld.gainUpdated.connect((trackId, gain, muted) => {
          this.log('debug', `gainUpdated track=${trackId} gain=${gain} muted=${muted}`)
        })

        this.updateStatus(InstanceStatus.Ok)
      })
    })

    this.ws.on('close', () => {
      this.updateStatus(InstanceStatus.Disconnected)
      this.meld = null
      this.transport = null
      this.log('warn', 'WebSocket closed')
    })

    this.ws.on('error', (err) => {
      this.updateStatus(InstanceStatus.Error, err.message)
      this.log('error', `WebSocket error: ${err.message}`)
    })
  }

  _disconnect() {
    if (this.ws) {
      try { this.ws.close() } catch {}
    }
    this.ws = null
    this.transport = null
    this.meld = null
  }

  _initActions() {
    const sceneChoices = this._getSceneChoices()

    this.setActionDefinitions({
      toggleRecord: { name: 'Toggle Record', options: [], callback: () => this._mCall('toggleRecord') },
      toggleStream: { name: 'Toggle Stream', options: [], callback: () => this._mCall('toggleStream') },

      showScene: {
        name: 'Show Scene',
        options: [
          { type: 'dropdown', id: 'sceneId', label: 'Scene', choices: sceneChoices, default: sceneChoices[0]?.id ?? '', allowCustom: true },
        ],
        callback: (evt) => this._mCall('showScene', evt.options.sceneId),
      },

      setStagedScene: {
        name: 'Set Staged Scene',
        options: [
          { type: 'dropdown', id: 'sceneId', label: 'Scene', choices: sceneChoices, default: sceneChoices[0]?.id ?? '', allowCustom: true },
        ],
        callback: (evt) => this._mCall('setStagedScene', evt.options.sceneId),
      },

      showStagedScene: { name: 'Show Staged Scene', options: [], callback: () => this._mCall('showStagedScene') },

      toggleMute: {
        name: 'Toggle Mute (Track ID)',
        options: [{ type: 'textinput', id: 'trackId', label: 'Track ID', default: '' }],
        callback: (evt) => this._mCall('toggleMute', evt.options.trackId),
      },
      toggleMonitor: {
        name: 'Toggle Monitor (Track ID)',
        options: [{ type: 'textinput', id: 'trackId', label: 'Track ID', default: '' }],
        callback: (evt) => this._mCall('toggleMonitor', evt.options.trackId),
      },

      toggleLayer: {
        name: 'Toggle Layer (Scene ID + Layer ID)',
        options: [
          { type: 'dropdown', id: 'sceneId', label: 'Scene', choices: sceneChoices, default: sceneChoices[0]?.id ?? '', allowCustom: true },
          { type: 'textinput', id: 'layerId', label: 'Layer ID', default: '' },
        ],
        callback: (evt) => this._mCall('toggleLayer', evt.options.sceneId, evt.options.layerId),
      },

      toggleEffect: {
        name: 'Toggle Effect (Scene + Layer + Effect ID)',
        options: [
          { type: 'dropdown', id: 'sceneId', label: 'Scene', choices: sceneChoices, default: sceneChoices[0]?.id ?? '', allowCustom: true },
          { type: 'textinput', id: 'layerId', label: 'Layer ID', default: '' },
          { type: 'textinput', id: 'effectId', label: 'Effect ID', default: '' },
        ],
        callback: (evt) => this._mCall('toggleEffect', evt.options.sceneId, evt.options.layerId, evt.options.effectId),
      },

      setGain: {
        name: 'Set Gain (Track ID, 0.0–1.0)',
        options: [
          { type: 'textinput', id: 'trackId', label: 'Track ID', default: '' },
          { type: 'number', id: 'gain', label: 'Gain (0–1)', default: 0.5, min: 0, max: 1, step: 0.01 },
        ],
        callback: (evt) => this._mCall('setGain', evt.options.trackId, Number(evt.options.gain)),
      },

      sendCommand: {
        name: 'Send Command (string)',
        options: [{ type: 'textinput', id: 'command', label: 'Command', default: 'meld.screenshot' }],
        callback: (evt) => this._mCall('sendCommand', evt.options.command),
      },
    })
  }

  _mCall(name, ...args) {
    if (!this.meld) {
      this.log('warn', 'Meld not ready')
      return
    }
    try {
      const fn = this.meld[name]
      if (typeof fn === 'function') {
        fn(...args)
      } else {
        this.log('error', `Unknown Meld function: ${name}`)
      }
    } catch (e) {
      this.log('error', `Call failed: ${name}(${args.join(', ')}): ${e.message}`)
    }
  }
}

runEntrypoint(MeldStudioInstance)
