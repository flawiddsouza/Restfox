import * as vscode from 'vscode'
import path from 'path'
import { readFileSync } from 'fs'

export function activate(context: vscode.ExtensionContext) {
	const disposable = vscode.commands.registerCommand('restfox.helloWorld', () => {
        const panel = vscode.window.createWebviewPanel(
            'restfox',
            'Restfox',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
            }
        )

        const vsuri = panel.webview.asWebviewUri(
			vscode.Uri.joinPath(context.extensionUri, 'ui')
        )

        const htmlPath = path.join(context.extensionPath, 'ui', 'index.html')
        let html = readFileSync(htmlPath, 'utf-8')


        html = html.replace(/src="([^"]*)"/g, (match, src) => {
            return `src="${vsuri}/${src}"`
        })

        html = html.replace(/href="([^"]*)"/g, (match, href) => {
            return `href="${vsuri}/${href}"`
        })

        panel.webview.html = html
	})

	context.subscriptions.push(disposable)
}

export function deactivate() {}
