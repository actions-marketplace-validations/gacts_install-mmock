const core = require('@actions/core') // docs: https://github.com/actions/toolkit/tree/main/packages/core
const tc = require('@actions/tool-cache') // docs: https://github.com/actions/toolkit/tree/main/packages/tool-cache
const github = require('@actions/github') // docs: https://github.com/actions/toolkit/tree/main/packages/github
const io = require('@actions/io') // docs: https://github.com/actions/toolkit/tree/main/packages/io
const cache = require('@actions/cache') // docs: https://github.com/actions/toolkit/tree/main/packages/cache
const exec = require('@actions/exec') // docs: https://github.com/actions/toolkit/tree/main/packages/exec
const semver = require('semver') // docs: https://github.com/npm/node-semver#readme
const path = require('path')
const os = require('os')

// read action inputs
const input = {
  version: core.getInput('version', {required: true}).replace(/^v/, ''), // strip the 'v' prefix
  githubToken: core.getInput('github-token'),
}

// main action entrypoint
async function runAction() {
  let version

  if (input.version.toLowerCase() === 'latest') {
    core.debug('Requesting latest MMock version...')
    version = await getLatestMMockVersion(input.githubToken)
  } else {
    version = input.version
  }

  core.startGroup('💾 Install MMock')
  await doInstall(version)
  core.endGroup()

  core.startGroup('🧪 Installation check')
  await doCheck()
  core.endGroup()
}

/**
 * @param {string} version
 *
 * @returns {Promise<void>}
 *
 * @throws
 */
async function doInstall(version) {
  const pathToInstall = path.join(os.tmpdir(), `mmock-${version}`)
  const cacheKey = `mmock-cache-${version}-${process.platform}-${process.arch}`

  core.info(`Version to install: ${version} (target directory: ${pathToInstall})`)

  let restoredFromCache = undefined

  try {
    restoredFromCache = await cache.restoreCache([pathToInstall], cacheKey)
  } catch (e) {
    core.warning(e)
  }

  if (restoredFromCache !== undefined) { // cache HIT
    core.info(`👌 MMock restored from cache`)
  } else { // cache MISS
    const distUri = getMMockURI(process.platform, process.arch, version)
    const distPath = await tc.downloadTool(distUri)

    switch (true) {
      case distUri.endsWith('tar.gz'):
        await tc.extractTar(distPath, pathToInstall)
        break

      case distUri.endsWith('zip'):
        await tc.extractZip(distPath, pathToInstall)
        break

      default:
        throw new Error('Unsupported distributive format')
    }

    await io.rmRF(distPath)

    try {
      await cache.saveCache([pathToInstall], cacheKey)
    } catch (e) {
      core.warning(e)
    }
  }

  core.addPath(pathToInstall)
}

/**
 * @returns {Promise<void>}
 *
 * @throws
 */
async function doCheck() {
  const mmockBinPath = await io.which('mmock', true)

  if (mmockBinPath === "") {
    throw new Error('mmock binary file not found in $PATH')
  }

  let output = ''

  await exec.exec('mmock', ['-h'], {
    silent: true,
    ignoreReturnCode: true,
    listeners: {
      stdout: data => output += data.toString(),
      stderr: data => output += data.toString(),
    }
  })

  if (!output.toLowerCase().includes('mmock v')) {
    throw new Error(`The output does not contain the required substring: ${output}`)
  }

  core.setOutput('mmock-bin', mmockBinPath)

  core.info(`MMock installed: ${mmockBinPath}`)
}

/**
 * @param {string} githubAuthToken
 * @returns {Promise<string>}
 */
async function getLatestMMockVersion(githubAuthToken) {
  const octokit = github.getOctokit(githubAuthToken)

  // docs: https://octokit.github.io/rest.js/v18#repos-get-latest-release
  const latest = await octokit.rest.repos.getLatestRelease({
    owner: 'jmartin82',
    repo: 'mmock',
  })

  return latest.data.tag_name.replace(/^v/, '') // strip the 'v' prefix
}

/**
 * @link https://github.com/jmartin82/mmock/releases
 *
 * @param {('linux'|'darwin'|'win32')} platform
 * @param {('x32'|'x64'|'arm'|'arm64')} arch
 * @param {string} version E.g.: `3.0.2`
 *
 * @returns {string}
 *
 * @throws
 */
function getMMockURI(platform, arch, version) {
  const namingVersion = semver.lt(version, '3.0.1') ? 1 : 2;

  switch (platform) {
    case 'linux': {
      switch (arch) {
        case 'x64': // Amd64
          switch (namingVersion) {
            case 1: // old
              return `https://github.com/jmartin82/mmock/releases/download/v${version}/mmock_${version}_linux_64-bit.tar.gz`

            case 2: // since 3.0.1
              return `https://github.com/jmartin82/mmock/releases/download/v${version}/mmock_Linux_x86_64.tar.gz`
          }
      }

      throw new Error('Unsupported linux architecture')
    }

    case 'darwin': {
      switch (arch) {
        case 'x64': // Amd64
          switch (namingVersion) {
            case 1: // old
              return `https://github.com/jmartin82/mmock/releases/download/v${version}/mmock_${version}_macOS_64-bit.tar.gz`

            case 2: // since 3.0.1
              return `https://github.com/jmartin82/mmock/releases/download/v${version}/mmock_macOS_x86_64.tar.gz`
          }
      }

      throw new Error('Unsupported MacOS architecture')
    }

    case 'win32': {
      switch (arch) {
        case 'x64': // Amd64
          switch (namingVersion) {
            case 1: // old
              return `https://github.com/jmartin82/mmock/releases/download/v${version}/mmock_${version}_windows_64-bit.tar.gz`

            case 2: // since 3.0.1
              return `https://github.com/jmartin82/mmock/releases/download/v${version}/mmock_Windows_x86_64.zip`
          }
      }

      throw new Error('Unsupported windows architecture')
    }
  }

  throw new Error('Unsupported OS (platform)')
}

// run the action
(async () => {
  await runAction()
})().catch(error => {
  core.setFailed(error.message)
})
