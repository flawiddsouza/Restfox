module.exports = {
    packagerConfig: {
        name: 'Restfox',
        icon: 'ui/favicon',
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
        }
    },
    makers: [
        {
            name: '@electron-forge/maker-squirrel',
            config: {
                name: 'Restfox',
                iconUrl: 'https://restfox.dev/favicon.ico',
                setupIcon: 'ui/favicon.ico'
            }
        },
        {
            name: '@electron-forge/maker-zip',
            platforms: [
                'darwin'
            ]
        },
        {
            name: '@electron-forge/maker-deb',
            config: {}
        },
        {
            name: '@electron-forge/maker-rpm',
            config: {}
        }
    ],
    publishers: [
        {
            name: '@electron-forge/publisher-github',
            config: {
                repository: {
                    'owner': 'flawiddsouza',
                    'name': 'Restfox'
                },
                prerelease: true
            }
        }
    ]
}
