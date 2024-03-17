const fs = require('fs').promises

async function readdirIgnoreError(path) {
    try {
        return await fs.readdir(path)
    } catch (e) {
        return []
    }
}

module.exports = {
    readdirIgnoreError
}
