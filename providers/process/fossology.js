// Copyright (c) Microsoft Corporation and others. Licensed under the MIT license.
// SPDX-License-Identifier: MIT

const AbstractProcessor = require('./abstractProcessor')
const { exec } = require('child_process')
const fs = require('fs')
const path = require('path')

class FossologyProcessor extends AbstractProcessor {
  constructor(options) {
    super(options)
    // Kick off version detection but don't wait. We'll wait before processing anything
    this._versionPromise = this._detectVersion()
  }

  get toolVersion() {
    return this._toolVersion
  }

  get toolName() {
    return 'fossology'
  }

  canHandle(request) {
    return request.type === 'fossology'
  }

  async handle(request) {
    if (!(await this._versionPromise)) return request.markSkip('FOSSology tools not properly configured')
    super.handle(request)
    this.logger.info(`Analyzing ${request.toString()} using FOSSology. input: ${request.document.location}`)
    await this._createDocument(request)
    return request
  }

  async _createDocument(request) {
    const nomosOutput = await this._runNomos(request)
    const files = await this.filterFiles(request.document.location)
    const copyrightOutput = await this._runCopyright(request, files, request.document.location)
    const monkOutput = await this._runMonk(request, files, request.document.location)
    request.document = this.clone(request.document)
    if (!nomosOutput && !copyrightOutput && !monkOutput)
      request.markDead('Error', 'FOSSology run failed with no results')
    if (nomosOutput) request.document.nomos = nomosOutput
    if (copyrightOutput) request.document.copyright = copyrightOutput
    if (monkOutput) request.document.monk = monkOutput
  }

  async _runNomos(request) {
    return new Promise(resolve => {
      const parameters = [].join(' ')
      const file = this.createTempFile(request)
      exec(
        `cd ${this.options.installDir}/nomos/agent && ./nomossa -ld ${request.document.location} ${parameters} > ${
          file.name
        }`,
        error => {
          if (error) {
            this.logger.error(error)
            return resolve(null)
          }
          const output = {
            contentType: 'text/plain',
            content: fs
              .readFileSync(file.name)
              .toString()
              .replace(new RegExp(`${request.document.location}/`, 'g'), '')
          }
          const nomosOutput = { version: this._nomosVersion, parameters, output }
          resolve(nomosOutput)
        }
      )
    })
  }

  async _visitFiles(files, runner) {
    const results = []
    for (const file of files) {
      try {
        const output = await runner(file)
        if (output) results.push({ path: file, output: JSON.parse(output) })
      } catch (error) {
        this.logger.error(error)
      }
    }
    return { contentType: 'application/json', content: results }
  }

  async _runCopyright(request, files, root) {
    const parameters = ['-J']
    const output = await this._visitFiles(files, file =>
      this._runCopyrightOnFile(request, path.join(root, file), parameters)
    )
    return { version: this._copyrightVersion, parameters, output }
  }

  _runCopyrightOnFile(request, file, parameters = []) {
    return new Promise(resolve => {
      exec(
        `cd ${this.options.installDir}/copyright/agent && ./copyright --files ${file} ${parameters.join(' ')}`,
        (error, stdout) => {
          if (error) {
            this.logger.error(error)
            return resolve(null)
          }
          resolve(stdout)
        }
      )
    })
  }

  async _runMonk(request, files, root) {
    const parameters = ['-k', 'monk_knowledgebase'] // 'monk_knowledgebase' created at build time
    const chunkSize = 500
    const output = {
      contentType: 'text/plain',
      content: ''
    }
    for (let i = 0; i < files.length; i += chunkSize) {
      const outputFile = this.createTempFile(request)
      const fileArguments = files.slice(i, i + chunkSize).map(file => path.join(root, file))
      const data = await new Promise(resolve => {
        exec(
          `cd ${this.options.installDir}/monk/agent && ./monk ${parameters.join(' ')} ${fileArguments.join(' ')} > ${
            outputFile.name
          }`,
          error => {
            if (error) {
              this.logger.error(error)
              return resolve(null)
            }
            resolve(
              fs
                .readFileSync(outputFile.name)
                .toString()
                .replace(new RegExp(`${request.document.location}/`, 'g'), '')
            )
          }
        )
      })
      output.content += data
    }

    if (output.content) return { version: this._monkVersion, parameters, output }
    return null
  }

  async _detectVersion() {
    if (this._versionPromise) return this._versionPromise
    try {
      this._nomosVersion = await this._detectNomosVersion()
      this._copyrightVersion = await this._detectCopyrightVersion()
      this._monkVersion = await this._detectMonkVersion()
      // Treat the NOMOS version as the global FOSSology tool version
      this._toolVersion = this._nomosVersion
      this._schemaVersion = this.aggregateVersions([this._schemaVersion, this.toolVersion, this.configVersion])
      return this._schemaVersion
    } catch (error) {
      this.logger.log(`Could not find FOSSology tool version: ${error.message}`)
      return null
    }
  }

  _detectNomosVersion() {
    return new Promise((resolve, reject) => {
      exec(`cd ${this.options.installDir}/nomos/agent && ./nomossa -V`, (error, stdout) => {
        if (error) return reject(error)
        const rawVersion = stdout.replace('nomos build version:', '').trim()
        resolve(rawVersion.replace(/[-\s].*/, '').trim())
      })
    })
  }

  _detectMonkVersion() {
    // TODO remove this and uncomment exec once we are sure of how to get Monk to build with a version number
    // currently it always reports "no version available"
    return '0.0.0'
    // return new Promise((resolve, reject) => {
    //   exec(`cd ${this.options.installDir}/monk/agent && ./monk -V`, (error, stdout) => {
    //     if (error) return reject(error)
    //     const rawVersion = stdout.replace('monk version', '').trim()
    //     resolve(rawVersion.replace(/-.*/, '').trim())
    //   })
    // })
  }

  // TODO see how copyright outputs its version and format accordingly. The code appears to not have
  // a means of getting a version. So, for now, use 0.0.0 to simulate using the same version as
  // nomos. That will be taken as the overall version of the FOSSology support as they are
  // built from the same tree at the same time.
  _detectCopyrightVersion() {
    return '0.0.0'
  }
}

module.exports = options => new FossologyProcessor(options)
