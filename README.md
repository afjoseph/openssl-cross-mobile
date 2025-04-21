# openssl-cross-mobile: OpenSSL Cross-Platform Builder for iOS/Android platforms

A utility for building OpenSSL libraries across Android and iOS platforms from a macOS host

## Prerequisites

- macOS development environment
- [Bun](https://bun.sh/) runtime installed
- For Android builds:
  - Android NDK installed
  - `ANDROID_NDK_HOME` environment variable set
- For iOS builds:
  - Xcode with command-line tools installed

## Installation

```bash
git clone https://github.com/afjoseph/openssl-cross-mobile
cd openssl-cross-mobile
bun install
```

## Usage

### Build for All Platforms
```bash
bun index.ts --clean --openssl-version=3.4.0 --target=all
```

### Build for Android Only
```bash
bun index.ts --clean --openssl-version=3.4.0 --target=android --android-archs=arm64,x86_64 --android-api=28
```

### Build for iOS Simulator
```bash
bun index.ts --clean --openssl-version=3.4.0 --target=iphonesim --iphonesim-archs=x86_64,arm64
```

### Build for iOS Devices
```bash
bun index.ts --clean --openssl-version=3.4.0 --target=iphoneos --iphoneos-archs=arm64
```

### Options Breakdown

| Option                        | Description                                              | Default |
|-------------------------------|----------------------------------------------------------|---------|
| `--openssl-version <version>` | OpenSSL version to build                                 | 3.4.0   |
| `--target <target>`           | Target platform(s): android, iphonesim, iphoneos, or all | all     |
| `--clean`                     | Clean build directories                                  | false   |
| `--dist-path <path>`          | Output directory for built libraries                     | dist    |
| `-h, --help`                  | Show detailed help message                               | -       |

### Android-Specific Options

| Option                    | Description                             | Default |
|---------------------------|-----------------------------------------|---------|
| `--android-api <level>`   | Android API level                       | 21      |
| `--android-archs <archs>` | Android architectures (comma-separated) | arm64   |

### iOS-Specific Options

| Option                      | Description                                   | Default |
|-----------------------------|-----------------------------------------------|---------|
| `--iphoneos-archs <archs>`  | iOS device architectures (comma-separated)    | -       |
| `--iphonesim-archs <archs>` | iOS simulator architectures (comma-separated) | -       |

## Output Structure

Libraries are placed in the specified `dist-path` (default: `./dist`) with the following structure:

```
dist/
├── android/
│   ├── arm/
│   ├── arm64/
│   ├── x86/
│   ├── x86_64/
│   └── include/
├── iphoneos/
│   ├── libssl.a
│   ├── libcrypto.a
│   └── include/
└── iphonesim/
    ├── libssl.a
    ├── libcrypto.a
    └── include/
```

Android builds provide both static (`.a`) and dynamic (`.so`) libraries, while iOS builds provide static libraries only. This is by design. Make a PR or raise an issue if this is undesired behaviour for you

## Gotchas
- Building `x86_64` for `iphonesim` is not working on my M2 MacOS machine. The code can be easily adapted to it so if there's need for it, I can accommodate
    - furthermore, the OSX machines I'll be using for this project are definitely past M1
