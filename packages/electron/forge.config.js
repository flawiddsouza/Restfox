const path = require('path')
const fs = require('fs-extra')

module.exports = {
    packagerConfig: {
        name: 'Restfox',
        executableName: 'restfox',
        icon: path.join(__dirname, 'ui', 'favicon'),
        asar: true,
        prune: true,
        ignore: [
            /^\/dist$/,
            /^\/out$/,
            /^\/\.gitignore$/,
            /^\/\.eslintrc\.js$/,
            /^\/tsconfig\.json$/,
            /^\/vitest\.config\.ts$/,
            /^\/dev\.restfox\.Restfox\.metainfo\.xml$/,
            /^\/entitlements\.plist$/,
            /^\/forge\.config\.js$/,
        ],
        osxSign: {
            entitlements: 'entitlements.plist',
            'entitlements-inherit': 'entitlements.plist',
            'gatekeeper-assess': false,
            hardenedRuntime: true,
            identity: 'Developer ID Application: Athanasios Plastiras (Y46L589C5C)'
        },
        osxNotarize: {
            tool: 'notarytool',
            appleId: process.env.APPLE_ID,
            appleIdPassword: process.env.APPLE_ID_PASSWORD,
            teamId: process.env.APPLE_TEAM_ID
        },
    },
    rebuildConfig: {},
    makers: [
        {
            name: '@electron-forge/maker-deb',
            config: {
                options: {
                    maintainer: 'Restfox <restfox@example.com>',
                    homepage: 'https://restfox.dev',
                    icon: path.join(__dirname, 'ui', 'favicon.png'),
                },
            },
        },
        {
            name: '@electron-forge/maker-squirrel',
            config: {},
        },
        {
            name: '@electron-forge/maker-zip',
            platforms: ['darwin'],
        },
    ],
    hooks: {
        packageAfterCopy: async (config, buildPath, electronVersion, platform, arch) => {
            const uiDistPath = path.join(__dirname, '..', 'ui', 'dist')
            const destPath = path.join(buildPath, 'ui')
            
            console.log(`Copying UI from ${uiDistPath} to ${destPath}`)
            
            if (fs.existsSync(uiDistPath)) {
                await fs.copy(uiDistPath, destPath)
                console.log('UI files copied successfully')
            } else {
                console.error('ERROR: UI dist folder not found!')
                throw new Error('UI dist folder not found')
            }
        },
    },
}
