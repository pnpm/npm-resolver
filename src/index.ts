import getCredentialsByURI = require('credentials-by-uri')
import createRegFetcher from 'fetch-from-npm-registry'
import mem = require('mem')
import path = require('path')
import semver = require('semver')
import ssri = require('ssri')
import createPkgId from './createNpmPkgId'
import parsePref from './parsePref'
import pickPackage, {
  PackageInRegistry,
  PackageMeta,
} from './pickPackage'
import toRaw from './toRaw'

export default function createResolver (
  opts: {
    cert?: string,
    key?: string,
    ca?: string,
    strictSsl?: boolean,
    rawNpmConfig: object,
    metaCache: Map<string, object>,
    store: string,
    proxy?: string,
    httpsProxy?: string,
    localAddress?: string,
    userAgent?: string,
    offline?: boolean,
    preferOffline?: boolean,
    fetchRetries?: number,
    fetchRetryFactor?: number,
    fetchRetryMintimeout?: number,
    fetchRetryMaxtimeout?: number,
  },
) {
  if (typeof opts.rawNpmConfig !== 'object') {
    throw new TypeError('`opts.rawNpmConfig` is required and needs to be an object')
  }
  if (typeof opts.rawNpmConfig['registry'] !== 'string') { // tslint:disable-line
    throw new TypeError('`opts.rawNpmConfig.registry` is required and needs to be a string')
  }
  if (typeof opts.metaCache !== 'object') {
    throw new TypeError('`opts.metaCache` is required and needs to be an object')
  }
  if (typeof opts.store !== 'string') {
    throw new TypeError('`opts.store` is required and needs to be a string')
  }
  const fetch = createRegFetcher({
    ca: opts.ca,
    cert: opts.cert,
    key: opts.key,
    localAddress: opts.localAddress,
    proxy: opts.httpsProxy || opts.proxy,
    retry: {
      factor: opts.fetchRetryFactor,
      maxTimeout: opts.fetchRetryMaxtimeout,
      minTimeout: opts.fetchRetryMintimeout,
      retries: opts.fetchRetries,
    },
    strictSSL: opts.strictSsl,
    userAgent: opts.userAgent,
  })
  return resolveNpm.bind(null, {
    getCredentialsByURI: mem((registry: string) => getCredentialsByURI(registry, opts.rawNpmConfig)),
    pickPackage: pickPackage.bind(null, {
      fetch,
      metaCache: opts.metaCache,
      offline: opts.offline,
      preferOffline: opts.preferOffline,
      storePath: opts.store,
    }),
  })
}

async function resolveNpm (
  ctx: {
    pickPackage: Function, //tslint:disable-line
    getCredentialsByURI: (registry: string) => object,
  },
  wantedDependency: {
    alias?: string,
    pref: string,
  },
  opts: {
    dryRun?: boolean,
    registry: string,
    preferredVersions?: {
      [packageName: string]: {
        selector: string,
        type: 'version' | 'range' | 'tag',
      },
    },
  },
) {
  const spec = parsePref(wantedDependency.pref, wantedDependency.alias)
  if (!spec) return null
  const auth = ctx.getCredentialsByURI(opts.registry)
  const pickResult = await ctx.pickPackage(spec, {
    auth,
    dryRun: opts.dryRun === true,
    preferredVersionSelector: opts.preferredVersions && opts.preferredVersions[spec.name],
    registry: opts.registry,
  })
  const pickedPackage = pickResult.pickedPackage
  const meta = pickResult.meta
  if (!pickedPackage) {
    const versions = Object.keys(meta.versions)
    const message = versions.length
      ? 'Versions in registry:\n' + versions.join(', ') + '\n'
      : 'No valid version found.'
    const err = new Error('No compatible version found: ' +
      toRaw(spec) + '\n' + message)
    throw err
  }
  const id = createPkgId(pickedPackage.dist.tarball, pickedPackage.name, pickedPackage.version)

  const resolution = {
    integrity: getIntegrity(pickedPackage.dist),
    registry: opts.registry,
    tarball: pickedPackage.dist.tarball,
  }
  return {
    id,
    latest: meta['dist-tags'].latest,
    package: pickedPackage,
    resolution,
  }
}

function getIntegrity (dist: {
  integrity?: string,
  shasum: string,
  tarball: string,
}) {
  if (dist.integrity) {
    return dist.integrity
  }
  return ssri.fromHex(dist.shasum, 'sha1').toString()
}
