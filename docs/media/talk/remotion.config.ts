import { Config } from '@remotion/cli/config'

Config.setVideoImageFormat('jpeg')
Config.setCodec('h264')
Config.setPixelFormat('yuv420p')
Config.setCrf(18)
// Reuse the installed Chrome: no browser download, and the same renderer the other media scripts use.
Config.setBrowserExecutable('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
