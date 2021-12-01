<template>
    <div class="request-panel-address-bar">
        <select>
            <option>GET</option>
            <option>POST</option>
            <option>PUT</option>
            <option>PATCH</option>
            <option>DELETE</option>
            <option>OPTIONS</option>
            <option>HEAD</option>
        </select>
        <input type="text" spellcheck="false">
        <button>Send</button>
    </div>
    <div class="request-panel-tabs">
        <div class="request-panel-tab request-panel-tab-active">Body</div>
        <div class="request-panel-tab">Query</div>
        <div class="request-panel-tab">Header</div>
        <div class="request-panel-tab-fill"></div>
    </div>
    <div class="request-panel-tabs-context"></div>
</template>

<style scoped>
.request-panel-address-bar {
    display: flex;
    border-bottom: 1px solid var(--default-border-color);
    height: 2rem;
}

.request-panel-address-bar > input {
    width: 100%;
}

.request-panel-address-bar > input, .request-panel-address-bar > select, .request-panel-address-bar > button {
    border: 0;
}

.request-panel-address-bar input, .request-panel-address-bar select {
    padding: 5px;
    outline: 0;
}

.request-panel-tabs {
    display: flex;
}

.request-panel-tabs .request-panel-tab {
    padding: 10px 15px;
    border-bottom: 1px solid var(--default-border-color);
}

.request-panel-tabs .request-panel-tab-active {
    border-bottom: 1px solid transparent;
    border-right: 1px solid var(--default-border-color);
}

.request-panel-tabs .request-panel-tab-fill {
    width: 100%;
    border-bottom: 1px solid var(--default-border-color);
}
</style>
