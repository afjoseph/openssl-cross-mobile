import { $ } from "bun";
import fs from "fs";
import path from "path";
import { Command } from "commander";
import * as logger from "winston";

const log = logger.createLogger({
  level: "debug",
  format: logger.format.combine(
    logger.format.errors({ stack: true }),
    logger.format.timestamp(),
    logger.format.colorize(),
    logger.format.printf(
      ({ timestamp, level, message }) => `${timestamp} ${level}: ${message}`,
    ),
  ),
  transports: [new logger.transports.Console()],
});

const HELP_TEXT = `
OpenSSL Cross-Platform Builder
=============================

This script builds OpenSSL libraries for Android and iOS platforms from a macOS host.

Environment Requirements:
------------------------
- For Android builds: ANDROID_NDK_HOME environment variable must be set
- For iOS builds: Xcode must be installed with command line tools

Examples:
--------------

1. Build for all
    bun index.ts --cc $(which clang) --clean --openssl-version=3.4.0 --target=all

2. Build for Android only
    bun index.ts --cc $(which clang) --clean --openssl-version 3.4.0 --target=android --android-archs arm64 --android-api 28

3. Build for iphonesim only
    bun index.ts --cc $(which clang) --clean --openssl-version=3.4.0 --target=iphonesim --iphonesim-archs=x86_64,arm64

4. Build for iphoneos only
    bun index.ts --cc $(which clang) --clean --openssl-version=3.4.0 --target=iphoneos ---iphoneos-archs=arm64
`;

type Options = {
  opensslVersion: string;
  target: "android" | "iphonesim" | "iphoneos" | "all";
  clean: boolean;
  distPath: string;
  androidAPI: string;
  androidArchs: string;
  iphoneosArchs: string;
  iphonesimArchs: string;
};

function createOptions(input: any): Options {
  if (!input.opensslVersion) {
    throw new Error("OpenSSL version not specified");
  }
  return {
    opensslVersion: input.opensslVersion,
    target: input.target,
    clean: input.clean || true,
    distPath: path.resolve(input.distPath),
    androidAPI: input.androidAPI,
    androidArchs: input.androidArchs,
    iphoneosArchs: input.iphoneosArchs,
    iphonesimArchs: input.iphonesimArchs,
  };
}

async function downloadOpenssl(
  opensslVersion: string,
  shouldClean: boolean,
): Promise<string> {
  const downloadPath = `/tmp/openssl-${opensslVersion}.tar.gz`;
  if (fs.existsSync(downloadPath) && !shouldClean) {
    log.info(`Using existing OpenSSL tar in ${downloadPath}`);
    return downloadPath;
  }
  const srcPath = `/tmp/openssl-${opensslVersion}`;
  await $`rm -rf ${downloadPath}`;
  await $`rm -rf ${srcPath}`;
  await $`mkdir -p ${srcPath}`;
  log.info(`Downloading OpenSSL ${opensslVersion} to ${downloadPath}`);
  const response = await fetch(
    `https://www.openssl.org/source/openssl-${opensslVersion}.tar.gz`,
  );
  const arrayBuffer = await response.arrayBuffer();
  await Bun.write(downloadPath, arrayBuffer);
  // Clean up on exit
  if (shouldClean) {
    process.on("exit", async () => {
      try {
        log.debug(`Cleaning up ${downloadPath}`);
        await $`rm -rf ${downloadPath}`;
      } catch (error) {
        log.error(`Failed to clean up ${downloadPath}: ${error}`);
      }
    });
  }
  return downloadPath;
}

// Function that executes callback in a specific directory and returns to
// original directory. Returns whatever callback returns.
async function withDir<T>(
  dirPath: string,
  callback: () => Promise<T>,
): Promise<T> {
  const originalDir = process.cwd();
  try {
    process.chdir(dirPath);
    return await callback();
  } finally {
    // Always change back to the original directory, even if an error occurs
    process.chdir(originalDir);
  }
}

/**
 * See https://github.com/openssl/openssl/blob/070b6a9/Configurations/15-android.conf
 * Builds OpenSSL for Android
 * @param tarPath Path to the OpenSSL tarball
 * @param options Build options
 */
async function buildForAndroid(
  tarPath: string,
  options: Options,
): Promise<void> {
  log.info("Building OpenSSL for Android");
  const archs = options.androidArchs.split(",");
  for (const arch of archs) {
    if (!["arm", "arm64", "x86", "x86_64"].includes(arch)) {
      throw new Error(`Invalid Android architecture: ${arch}`);
    }
  }
  // Check NDK
  const androidNDKHome = process.env.ANDROID_NDK_HOME;
  if (!androidNDKHome) {
    throw new Error("Please set ANDROID_NDK_HOME environment variable");
  }
  const toolchainPath = `${androidNDKHome}/toolchains/llvm/prebuilt`;
  if (!fs.existsSync(toolchainPath)) {
    throw new Error(
      "Please set ANDROID_NDK_HOME environment variable to the correct path",
    );
  }
  // Check and get host platform directory (like darwin-x86_64)
  const hostDirs = await $`ls ${toolchainPath}`
    .text()
    .then((output) => output.trim().split("\n"));
  if (hostDirs.length !== 1) {
    throw new Error("Failed to find a suitable toolchain");
  }
  const toolchainBinPath = `${toolchainPath}/${hostDirs[0]}/bin`;

  // Untar
  const distPath = `${options.distPath}/android`;
  await $`mkdir -p ${distPath}`;
  const srcPath = `/tmp/openssl_android`;
  if (fs.existsSync(srcPath) && !options.clean) {
    log.info(`Using existing build in ${srcPath}`);
    return;
  }
  await $`rm -rf ${srcPath}`;
  await $`mkdir -p ${srcPath}`;
  log.debug(`Extracting OpenSSL from ${tarPath} to ${srcPath}`);
  try {
    await $`tar xf ${tarPath} -C ${srcPath}`;
  } catch (error) {
    throw new Error(`Failed to untar OpenSSL: ${error}`);
  }
  if (!fs.existsSync(srcPath)) {
    throw new Error("Failed to extract OpenSSL to correct path");
  }
  const extractedSrcPath = `${srcPath}/openssl-${options.opensslVersion}`;

  // Build for each arch
  await withDir(extractedSrcPath, async () => {
    for (const arch of archs) {
      log.info(`Building OpenSSL for Android ${arch}`);
      try {
        // Configure for this architecture
        const installPath = `/tmp/openssl-android-${arch}`;
        // Clean up on exit
        if (options.clean) {
          process.on("exit", async () => {
            try {
              log.debug(`Cleaning up ${installPath}`);
              await $`rm -rf ${installPath}`;
            } catch (error) {
              log.error(`Failed to clean up ${installPath}: ${error}`);
              // Print stack trace
            }
          });
        }
        await $`rm -rf ${installPath}`;
        // Build
        process.env.ANDROID_NDK_HOME = androidNDKHome;
        process.env.ANDROID_API = options.androidAPI;
        process.env.PATH = `${toolchainBinPath}:${process.env.PATH}`;
        const config = `android-${arch}`;
        log.debug(
          `Configuring and building for Android ${arch}. Will install in ${installPath}: Config: ${config}`,
        );
        await $`./Configure ${config} -fPIC no-ui-console no-engine no-filenames no-stdio --prefix=${installPath}`;
        await $`make -j8`;
        await $`make -j8 install_sw`;
        await $`make -j8 install_ssldirs`;
        // Copy to dist
        const archDistPath = `${distPath}/${arch}`;
        await $`mkdir -p ${archDistPath}`;
        for (const lib of [
          "libssl.a",
          "libcrypto.a",
          "libssl.so",
          "libcrypto.so",
        ]) {
          const srcLibPath = `${installPath}/lib/${lib}`;
          const dstLibPath = `${archDistPath}/${lib}`;
          if (fs.existsSync(srcLibPath)) {
            log.debug(`Copying ${srcLibPath} to ${dstLibPath}`);
            await $`cp -a ${srcLibPath} ${dstLibPath}`;
          } else {
            throw new Error(`Library ${lib} not found`);
          }
        }
        // Copy include files of the last arch
        // XXX <20-04-2025,afjoseph> It looks like the include files
        // are not architecture-specific, so we can get away with copying just
        // the last built arch and don't need to be specific
        await $`rm -rf ${distPath}/include`;
        await $`cp -a ${installPath}/include ${distPath}`;
      } catch (error) {
        throw new Error(
          `Failed to build OpenSSL for Android ${arch}: ${error}`,
        );
      }
    }
  });
}

/**
 * See https://github.com/openssl/openssl/blob/070b6a9/Configurations/15-ios.conf for more info
 *
 * Builds OpenSSL for iphoneOS
 * @param tarPath Path to the OpenSSL tarball
 * @param options Build options
 */
async function buildForIosIphoneos(
  tarPath: string,
  options: Options,
): Promise<void> {
  log.info("Building OpenSSL for iOS devices");

  // Validate options
  if (!options.iphoneosArchs) {
    throw new Error("iOS architectures not specified");
  }
  // Get Xcode developer path
  let developerPath;
  try {
    developerPath = (await $`xcode-select -print-path`.text()).trim();
  } catch (error) {
    throw new Error(`Error getting Xcode developer path: ${error}`);
  }
  // Untar
  const distPath = `${options.distPath}/iphoneos`;
  await $`mkdir -p ${distPath}`;
  const srcPath = `/tmp/openssl_iphoneos`;
  if (fs.existsSync(srcPath) && !options.clean) {
    log.info(`Using existing build in ${srcPath}`);
    return;
  }
  await $`rm -rf ${srcPath}`;
  await $`mkdir -p ${srcPath}`;
  log.debug(`Extracting OpenSSL from ${tarPath} to ${srcPath}`);
  try {
    await $`tar xf ${tarPath} -C ${srcPath}`;
  } catch (error) {
    throw new Error(`Failed to untar OpenSSL: ${error}`);
  }
  if (!fs.existsSync(srcPath)) {
    throw new Error("Failed to extract OpenSSL to correct path");
  }
  const extractedSrcPath = `${srcPath}/openssl-${options.opensslVersion}`;
  // Register cleanup
  if (options.clean) {
    process.on("exit", async () => {
      try {
        log.debug(`Cleaning up ${srcPath}`);
        await $`rm -rf ${srcPath}`;
      } catch (error) {
        log.error(`Failed to clean up ${srcPath}`);
      }
    });
  }

  // Build for each arch
  await withDir(extractedSrcPath, async (): Promise<void> => {
    const archs = options.iphoneosArchs.split(",");
    let installPath = "";
    for (const arch of archs) {
      log.info(`Building OpenSSL for iPhone OS ${arch}`);
      try {
        // Build
        // process.env.CROSS_TOP = `${developerPath}/Platforms/iPhoneOS.platform/Developer`;
        const config = arch === "arm64" ? "ios64-xcrun" : "ios-xcrun";
        installPath = `/tmp/openssl-iphoneos-${arch}`;
        // Clean up on exit
        if (options.clean) {
          process.on("exit", async () => {
            try {
              log.debug(`Cleaning up ${installPath}`);
              await $`rm -rf ${installPath}`;
            } catch (error) {
              log.error(`Failed to clean up ${installPath}`);
            }
          });
        }
        log.debug(
          `Configuring and building for iPhone OS ${arch} in ${installPath}`,
        );
        await $`rm -rf ${installPath}`;
        await $`./Configure ${config} no-ui-console no-engine no-filenames no-shared --prefix=${installPath}`;
        await $`make -j8`;
        await $`make -j8 install_sw`;
        await $`make -j8 install_ssldirs`;
        // Copy libs
        for (const lib of ["libssl.a", "libcrypto.a"]) {
          const srcLibPath = `${installPath}/lib/${lib}`;
          const dstLibPath = `${distPath}/${lib}`;
          if (fs.existsSync(srcLibPath)) {
            log.debug(`Copying ${srcLibPath} to ${dstLibPath}`);
            // For multiple architectures, we'll combine them with lipo later
            if (archs.length > 1) {
              await $`cp ${srcLibPath} ${dstLibPath}.${arch}`;
            } else {
              await $`cp ${srcLibPath} ${dstLibPath}`;
            }
          } else {
            throw new Error(`Library ${lib} not found`);
          }
        }
        // Copy include files of the last arch
        // XXX <20-04-2025,afjoseph> It looks like the include files
        // are not architecture-specific, so we can get away with copying just
        // the last built arch and don't need to be specific
        await $`rm -rf ${distPath}/include`;
        await $`cp -a ${installPath}/include ${distPath}`;
      } catch (error) {
        throw new Error(
          `Failed building OpenSSL for iPhone OS ${arch}: ${error}`,
        );
      }
    }
    // Create a fat bin if multiple architectures
    if (archs.length > 1) {
      log.info("Creating a fat binary for iphoneos");
      for (const lib of ["libssl.a", "libcrypto.a"]) {
        const archFiles = archs
          .map((arch) => `${distPath}/${lib}.${arch}`)
          .join(" ");
        await $`lipo ${archFiles} -create -output ${distPath}/${lib}`;
        // Clean up individual arch files
        for (const arch of archs) {
          await $`rm ${distPath}/${lib}.${arch}`;
        }
      }
    }
  });
}

/**
 * See https://github.com/openssl/openssl/blob/070b6a9/Configurations/15-ios.conf for more info
 *
 * Builds OpenSSL for iphonesim
 * @param tarPath Path to the OpenSSL tarball
 * @param options Build options
 * @returns Path where OpenSSL was installed
 */
async function buildForIosIphonesim(
  tarPath: string,
  options: Options,
): Promise<void> {
  log.info("Building OpenSSL for iphonesim");

  // Validate options
  if (!options.iphonesimArchs) {
    throw new Error("iOS simulator architectures not specified");
  }

  // Get Xcode developer path
  let developerPath;
  try {
    developerPath = (await $`xcode-select -print-path`.text()).trim();
  } catch (error) {
    throw new Error(`Error getting Xcode developer path: ${error}`);
  }

  // Untar
  const distPath = `${options.distPath}/iphonesim`;
  await $`mkdir -p ${distPath}`;
  const srcPath = `/tmp/openssl_iphonesim`;
  if (fs.existsSync(srcPath) && !options.clean) {
    log.info(`Using existing build in ${srcPath}`);
    return;
  }
  await $`rm -rf ${srcPath}`;
  await $`mkdir -p ${srcPath}`;
  log.debug(`Extracting OpenSSL from ${tarPath} to ${srcPath}`);
  try {
    await $`tar xf ${tarPath} -C ${srcPath}`;
  } catch (error) {
    throw new Error(`Failed to untar OpenSSL: ${error}`);
  }
  if (!fs.existsSync(srcPath)) {
    throw new Error("Failed to extract OpenSSL to correct path");
  }
  const extractedSrcPath = `${srcPath}/openssl-${options.opensslVersion}`;
  // Register cleanup
  if (options.clean) {
    process.on("exit", async () => {
      try {
        log.debug(`Cleaning up ${srcPath}`);
        await $`rm -rf ${srcPath}`;
      } catch (error) {
        log.error(`Failed to clean up ${srcPath}`);
      }
    });
  }

  await withDir(extractedSrcPath, async (): Promise<void> => {
    const archs = options.iphonesimArchs.split(",");
    for (const arch of archs) {
      log.info(`Building OpenSSL for iOS simulator ${arch}`);
      try {
        // Build
        // process.env.CROSS_COMPILE = path.dirname(options.cc);
        // process.env.CROSS_TOP = `${developerPath}/Platforms/iPhoneSimulator.platform/Developer`;
        const config =
          arch === "arm64"
            ? "iossimulator-arm64-xcrun"
            : "iossimulator-x86_64-xcrun";
        const installPath = `/tmp/openssl-iphonesim-${arch}`;
        // Clean up on exit
        if (options.clean) {
          process.on("exit", async () => {
            try {
              log.debug(`Cleaning up ${installPath}`);
              await $`rm -rf ${installPath}`;
            } catch (error) {
              log.error(`Failed to clean up ${installPath}`);
            }
          });
        }
        log.debug(
          `Configuring and building for iOS simulator ${arch} in ${installPath}. Config: ${config}`,
        );
        await $`rm -rf ${installPath}`;
        await $`./Configure ${config} no-ui-console no-engine no-filenames no-shared --prefix=${installPath}`;
        await $`make -j8`;
        await $`make -j8 install_sw`;
        await $`make -j8 install_ssldirs`;
        // Copy libs
        for (const lib of ["libssl.a", "libcrypto.a"]) {
          const srcLibPath = `${installPath}/lib/${lib}`;
          const dstLibPath = `${distPath}/${lib}`;
          if (fs.existsSync(srcLibPath)) {
            log.debug(`Copying ${lib} for iphonesim ${arch}`);
            // For multiple architectures, we'll combine them with lipo later
            if (archs.length > 1) {
              await $`cp ${srcLibPath} ${dstLibPath}.${arch}`;
            } else {
              await $`cp ${srcLibPath} ${dstLibPath}`;
            }
          } else {
            throw new Error(`Library ${lib} not found`);
          }
        }
        // Copy include files of the last arch
        // XXX <20-04-2025,afjoseph> It looks like the include files
        // are not architecture-specific, so we can get away with copying just
        // the last built arch and don't need to be specific
        await $`rm -rf ${distPath}/include`;
        await $`cp -a ${installPath}/include ${distPath}`;
      } catch (error) {
        throw new Error(`Building OpenSSL for iphonesim ${arch}: ${error}`);
      }
    }
    // Create a fat bin if multiple architectures
    if (archs.length > 1) {
      log.info("Creating a fat binary for iphonesim");
      for (const lib of ["libssl.a", "libcrypto.a"]) {
        // XXX <20-04-2025,afjoseph> In Bun scripting, when you pass an array
        // to a $ command, it automatically expands it, so no need to join the
        // array into a string
        const archFiles = archs.map((arch) => `${distPath}/${lib}.${arch}`);
        await $`lipo ${archFiles} -create -output ${distPath}/${lib}`;
        // Clean up individual arch files
        for (const arch of archs) {
          await $`rm ${distPath}/${lib}.${arch}`;
        }
      }
    }
  });
}

async function main() {
  const program = new Command();
  program
    .option("--openssl-version <version>", "OpenSSL version to build", "3.4.0")
    .option(
      "--target <target>",
      "Target platform to build for: android, iphonesim, iphoneos, or all",
      "all",
    )
    .option("--clean", "Clean dist directory before building", false)
    .option(
      "--dist-path <path>",
      "Path to store the built OpenSSL libraries",
      "dist",
    )
    .option("--android-api <level>", "Android API level to build for", "21")
    .option(
      "--android-archs <archs>",
      "Comma-separated list of Android architectures to build for",
      "arm64",
    )
    .option(
      "--iphoneos-archs <archs>",
      "Comma-separated list of iOS device architectures to build for",
      "",
    )
    .option(
      "--iphonesim-archs <archs>",
      "Comma-separated list of iOS simulator architectures to build for",
      "",
    )
    .option("-h, --help", "Show detailed help message and exit", false);
  program.parse(process.argv);
  if (program.opts().help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  const options = createOptions(program.opts());
  log.info(`Options: ${JSON.stringify(options, null, 2)}`);
  // Nuke dist path to start fresh if clean option set
  if (options.clean) {
    await $`rm -rf ${options.distPath}`;
  }
  // Create dist directory
  await $`mkdir -p ${options.distPath}`;
  // Download and extract OpenSSL
  const tarPath = await downloadOpenssl(options.opensslVersion, options.clean);
  // Build based on target platform
  if (options.target === "android" || options.target === "all") {
    await buildForAndroid(tarPath, options);
  }
  if (options.target === "iphoneos" || options.target === "all") {
    await buildForIosIphoneos(tarPath, options);
  }
  if (options.target === "iphonesim" || options.target === "all") {
    await buildForIosIphonesim(tarPath, options);
  }
  log.info("Build completed successfully!");
}

try {
  await main();
} catch (error) {
  log.error(`${error}`);
  process.exit(1);
}
