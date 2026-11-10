import { createDbHelpers } from '../../electron/shared/db-helpers.js'
import * as fileUtils from './file-utils.js'

export const { getCollectionItem, getCollection, getCollectionPlugins, ensureRestfoxCollection, getEnvironments, saveEnvironments, serializeRequestFiles, deserializeRequestFiles, serializeRequestResponseFiles, deserializeRequestResponseFiles } = createDbHelpers(fileUtils, buffer => Array.from(Buffer.from(buffer, 'base64')))
