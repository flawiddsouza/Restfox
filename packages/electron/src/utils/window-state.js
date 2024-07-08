'use strict';
/**
 * ref: 
 * https://github.com/mawie81/electron-window-state 2701d9a
 * https://github.com/jmatth11/electron-window-state 98feced
 * 
 * https://github.com/mawie81/electron-window-state/pull/69
 * https://github.com/mawie81/electron-window-state/issues/27
 * https://github.com/whyboris/Video-Hub-App/issues/572
 */

const path = require('path');
const electron = require('electron');
const jsonfile = require('jsonfile');
const mkdirp = require('mkdirp');

module.exports = function (options) {
    const app = electron.app || electron.remote.app;
    const screen = electron.screen || electron.remote.screen;
    let state;
    let winRef;
    let stateChangeTimer;
    const eventHandlingDelay = 100;
    const config = Object.assign({
        file: 'window-state.json',
        path: app.getPath('userData'),
        maximize: true,
        fullScreen: true
    }, options);
    const fullStoreFileName = path.join(config.path, config.file);

    function isNormal(win) {
        return !win.isMaximized() && !win.isMinimized() && !win.isFullScreen();
    }

    function hasBounds() {
        return state &&
            Number.isInteger(state.x) &&
            Number.isInteger(state.y) &&
            Number.isInteger(state.width) && state.width > 0 &&
            Number.isInteger(state.height) && state.height > 0;
    }

    function resetStateToDefault() {
        const displayBounds = screen.getPrimaryDisplay().bounds;

        // Reset state to default values on the primary display
        state = {
            width: config.defaultWidth || 800,
            height: config.defaultHeight || 600,
            isMaximized: config.defaultMaximize || false,
            isFullScreen: config.defaultFullScreen || false,
            x: 0,
            y: 0,
            displayBounds
        };
    }

    function pointWithinBounds(point, bounds) {
        return (
            point.x >= bounds.x &&
            point.y >= bounds.y &&
            point.x < bounds.x + bounds.width &&
            point.y < bounds.y + bounds.height
        )
    }

    function newPoint(x, y) {
        return {
            x,
            y,
        };
    }

    function windowWithinBounds(bounds) {
        return (
            state.x >= bounds.x &&
            state.y >= bounds.y &&
            state.x + state.width <= bounds.x + bounds.width &&
            state.y + state.height <= bounds.y + bounds.height
        );
    }

    function ensureWindowVisibleOnSomeDisplay() {
        const points = [];
        points.push(newPoint(state.x, state.y));
        points.push(newPoint(state.x + state.width, state.y));
        const visible = points.some(point => {
            return screen.getAllDisplays().some(display => {
                return pointWithinBounds(newPoint(point.x, point.y), display.workArea);
            });
        })

        if (!visible) {
            // Window is partially or fully not visible now.
            // Reset it to safe defaults.
            return resetStateToDefault();
        }
    }

    function validateState() {
        const isValid = state && (hasBounds() || state.isMaximized || state.isFullScreen);
        if (!isValid) {
            state = null;
            return;
        }

        if (hasBounds() && state.displayBounds) {
            ensureWindowVisibleOnSomeDisplay();
        }
    }

    function updateState(win) {
        win = win || winRef;
        if (!win) {
            return;
        }
        // Don't throw an error when window was closed
        try {
            state.isMaximized = win.isMaximized();
            state.isFullScreen = win.isFullScreen();
            const winBounds = win.getBounds();
            if (isNormal(win)) {
                state.x = winBounds.x;
                state.y = winBounds.y;
                state.width = winBounds.width;
                state.height = winBounds.height;
                state.displayBounds = screen.getDisplayMatching(winBounds).bounds;
                // state.scale = screen.getDisplayMatching(winBounds).scaleFactor;
            }
        } catch (err) { }
    }

    function saveState(win) {
        // Update window state only if it was provided
        if (win) {
            updateState(win);
        }

        // Save state
        try {
            mkdirp.sync(path.dirname(fullStoreFileName));
            jsonfile.writeFileSync(fullStoreFileName, state);
        } catch (err) {
            // Don't care
        }
    }

    function stateChangeHandler() {
        // Handles both 'resize' and 'move'
        clearTimeout(stateChangeTimer);
        stateChangeTimer = setTimeout(updateState, eventHandlingDelay);
    }

    function closeHandler() {
        updateState();
    }

    function closedHandler() {
        // Unregister listeners and save state
        unmanage();
        saveState();
    }

    function manage(win) {
        if (config.fullScreen && state.isFullScreen) {
            win.setFullScreen(true);
        } else if (config.maximize && state.isMaximized) {
            win.maximize();
        }
        win.on('resize', stateChangeHandler);
        win.on('move', stateChangeHandler);
        win.on('close', closeHandler);
        win.on('closed', closedHandler);
        winRef = win;
    }

    function unmanage() {
        if (winRef) {
            winRef.removeListener('resize', stateChangeHandler);
            winRef.removeListener('move', stateChangeHandler);
            clearTimeout(stateChangeTimer);
            winRef.removeListener('close', closeHandler);
            winRef.removeListener('closed', closedHandler);
            winRef = null;
        }
    }

    function pointOnWhichDisplay(point) {
        return screen.getAllDisplays().find(display => {
            return pointWithinBounds(point, display.bounds);
        });
    }

    function calcScale() {
        if (state.x == undefined || state.y == undefined) {
            console.log("state x or y is undefined");
            return 1;
        }
        let point = newPoint(state.x, state.y);
        let display = pointOnWhichDisplay(point);
        if (display) {
            console.log(`"left top point: ${screen.getPrimaryDisplay().scaleFactor} / ${display.scaleFactor}"`);
            return screen.getPrimaryDisplay().scaleFactor / display.scaleFactor;
        }
        point = newPoint(state.x + state.width, state.y);
        display = pointOnWhichDisplay(point);
        if (display) {
            console.log(`"right top point: ${screen.getPrimaryDisplay().scaleFactor} / ${display.scaleFactor}"`);
            return screen.getPrimaryDisplay().scaleFactor / display.scaleFactor;
        }
        return 1;
    }

    // Load previous state
    try {
        state = jsonfile.readFileSync(fullStoreFileName);
    } catch (err) {
        // Don't care
    }

    // Check state validity
    validateState();

    // Set state fallback values
    state = Object.assign({
        width: config.defaultWidth || 800,
        height: config.defaultHeight || 600,
        isMaximized: config.defaultMaximize || false,
        isFullScreen: config.defaultFullScreen || false,
    }, state);

    // Calculate screen scale
    state.scale = calcScale();
    console.log(`scale: ${state.scale}`);
    state.width = parseInt(state.width * state.scale);
    state.height = parseInt(state.height * state.scale);

    return {
        get x() { return state.x; },
        get y() { return state.y; },
        get width() { return state.width; },
        get height() { return state.height; },
        get displayBounds() { return state.displayBounds; },
        get isMaximized() { return state.isMaximized; },
        get isFullScreen() { return state.isFullScreen; },
        saveState,
        unmanage,
        manage,
        resetStateToDefault
    };
};
