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
</style>
