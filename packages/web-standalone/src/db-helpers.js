import { createDbHelpers } from '../../electron/shared/db-helpers.js'
import * as fileUtils from './file-utils.js'

export const { getCollectionItem, getCollection, ensureRestfoxCollection, getEnvironments, saveEnvironments, serializeRequestFiles, deserializeRequestFiles, serializeRequestResponseFiles, deserializeRequestResponseFiles } = createDbHelpers(fileUtils, buffer => Array.from(Buffer.from(buffer, 'base64')))
