import * as Electron from "electron";

declare function windowStateKeeper(
    opts: windowStateKeeper.Options
): windowStateKeeper.State;

declare namespace windowStateKeeper {
    interface Options {
        /** The height that should be returned if no file exists yet. Defaults to `600`. */
        defaultHeight?: number;
        /** The width that should be returned if no file exists yet. Defaults to `800`. */
        defaultWidth?: number;
        /** The maximize that should be returned if no file exists yet. Defaults to `false`.
         * If true will ignore defaultHeight and defaultWidth.
         */
        defaultMaximize?: boolean;
        /** The fullScreen that should be returned if no file exists yet. Defaults to `false`. 
         * If true will ignore defaultHeight, defaultWidth and defaultMaximize.
        */
        defaultFullScreen?: boolean;
        fullScreen?: boolean;
        /** The path where the state file should be written to. Defaults to `app.getPath('userData')`. */
        path?: string;
        /** The name of file. Defaults to `window-state.json`. */
        file?: string;
        /** Should we automatically maximize the window, if it was last closed maximized. Defaults to `true`. */
        maximize?: boolean;
    }

    interface State {
        displayBounds: {
            height: number;
            width: number;
        };
        /** The saved height of loaded state. `defaultHeight` if the state has not been saved yet. */
        height: number;
        /** true if the window state was saved while the window was in full screen mode. `undefined` if the state has not been saved yet. */
        isFullScreen: boolean;
        /** `true` if the window state was saved while the window was maximized. `undefined` if the state has not been saved yet. */
        isMaximized: boolean;
        /** Register listeners on the given `BrowserWindow` for events that are related to size or position changes (resize, move). It will also restore the window's maximized or full screen state. When the window is closed we automatically remove the listeners and save the state. */
        manage: (window: Electron.BrowserWindow) => void;
        /** Saves the current state of the given `BrowserWindow`. This exists mostly for legacy purposes, and in most cases it's better to just use `manage()`. */
        saveState: (window: Electron.BrowserWindow) => void;
        /** Removes all listeners of the managed `BrowserWindow` in case it does not need to be managed anymore. */
        unmanage: () => void;
        /** The saved width of loaded state. `defaultWidth` if the state has not been saved yet. */
        width: number;
        /** The saved x coordinate of the loaded state. `undefined` if the state has not been saved yet. */
        x: number;
        /** The saved y coordinate of the loaded state. `undefined` if the state has not been saved yet. */
        y: number;
    }
}

export = windowStateKeeper;
