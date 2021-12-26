<template>
    <div class="dropdown__menu theme--dropdown__menu" :class="{ 'dropdown__menu--open': show }" aria-hidden="false">
        <div class="dropdown__backdrop theme--transparent-overlay" @click="$emit('update:show', false)"></div>
        <div tabindex="-1" class="dropdown__list" :style="{
            left: x,
            right: 'initial',
            top: y,
            bottom: 'initial',
            minWidth: 'initial',
            maxHeight: '316.328px'
        }">
            <div class="form-control dropdown__filter">
                <i class="fa fa-search"></i>
                <input type="text">
            </div>
            <ul>
                <template v-for="option in options">
                    <li>
                        <div class="dropdown__divider">
                            <span class="dropdown__divider__label">
                                <span>
                                    <i :class="option.icon"></i> {{ option.label }} </span>
                            </span>
                        </div>
                    </li>
                    <li v-for="innerOption in option.options">
                        <button type="button" :value="innerOption.value" @click="$emit('update:modelValue', innerOption); $emit('update:show', false);">
                            <div class="dropdown__inner">
                                <div class="dropdown__text">
                                    <i :class="`fa ${JSON.stringify(modelValue) === JSON.stringify(innerOption) ? 'fa-check' : 'fa-empty'}`"></i>{{ innerOption.label }}
                                </div>
                            </div>
                        </button>
                    </li>
                </template>
            </ul>
        </div>
    </div>
</template>

<script>
export default {
    props: {
        options: Array,
        modelValue: Object,
        x: String,
        y: String,
        show: {
            type: Boolean,
            default: false
        }
    }
}
</script>

<style scoped>
ul {
    list-style: none;
    padding: 0;
}

li {
    margin: 0;
    padding: 0;
    border: 0;
    vertical-align: baseline;
}

.fa {
    min-width: 1.1rem;
    text-align: center;
}

.dropdown {
  position: relative;
  display: inline-block;
  box-sizing: border-box;
  text-align: left;
}

.dropdown:focus {
  outline: none;
}

.dropdown__backdrop {
  position: fixed;
  z-index: 9999;
  display: none;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  content: ' ';
}

.dropdown__menu.dropdown__menu--open .dropdown__backdrop {
  display: block;
}

.dropdown__menu .dropdown__list {
  z-index: 99999;
  display: none;
  position: fixed;
  top: 0;
  left: 0;
  border: 1px solid #82828240;
  box-shadow: 0 0 1rem 0 rgba(0, 0, 0, 0.1);
  box-sizing: border-box;
  background: #ffffff;
  margin: calc(1rem * 0.2) 3px;
  padding-top: calc(1rem * 0.3);
  padding-bottom: calc(1rem * 0.3);
  border-radius: calc(1rem * 0.3);
  overflow: auto;
  user-select: none;
}

.dropdown__menu .dropdown__list .dropdown__filter {
  border: 1px solid #82828259;
  margin: calc(1rem * 0.4);
  width: auto;
  border-radius: calc(1rem * 0.2);
  display: flex;
  flex-direction: row;
  align-items: center;
  padding-left: calc(1rem * 0.6);
  position: absolute;
  left: -9999999px;
  color: #828282;
}

.dropdown__menu .dropdown__list .dropdown__filter input {
  margin: 0;
  padding: calc( 1rem * 0.4) calc(1rem * 0.6);
  color: #333333;
}

.dropdown__menu .dropdown__list.dropdown__list--filtering .dropdown__filter {
  position: static;
  left: auto;
}

.dropdown__menu .dropdown__list:focus {
  outline: 0;
}
.dropdown__menu .dropdown__list .dropdown__inner {
  width: 100%;
}

.dropdown__menu .dropdown__list .dropdown__text {
  white-space: nowrap;
  display: flex;
  flex-direction: row;
  align-items: center;
}

.dropdown__menu .dropdown__list .dropdown__text > *:not(:first-child) {
  margin-left: 0.3em;
}

.dropdown__menu .dropdown__list .dropdown__text .dropdown__hint,
.dropdown__menu .dropdown__list .dropdown__text .dropdown__right {
  color: #828282cc;
  margin-left: auto;
  padding-left: calc(1rem * 2.5);
}

.dropdown__menu .dropdown__list li > button {
    transition: all 130ms ease-out;
    box-sizing: border-box;
    text-align: left;
    font-size: inherit;
    text-decoration: inherit;
    background: none;
    border: 0;
    outline: 0;
    margin: 0;
    padding: 0;
    color: inherit;
    min-width: 12rem;
    text-align: left;
    padding-right: calc(1rem * 1.2);
    padding-left: calc(1rem * 0.6);
    height: 2.1rem;
    width: 100%;
    display: block;
    color: #333333 !important;
    white-space: nowrap;
}

.dropdown__menu .dropdown__list li > button i.fa:first-child {
  display: inline-block;
  width: 2.2em;
  text-align: center;
}

.dropdown__menu .dropdown__list li > button:hover:not(:disabled),
.dropdown__menu .dropdown__list li.active > button:not(:disabled) {
  background: #82828240;
}

.dropdown__menu .dropdown__list li > button:active:not(:disabled) {
  background: #82828259;
}

.dropdown__menu .dropdown__list .dropdown__divider {
  border-bottom: 1px solid #82828280;
  overflow: visible !important;
  height: 0;
  margin: 1.2rem;
}

.dropdown__menu .dropdown__list .dropdown__divider .dropdown__divider__label {
  position: relative;
  left: calc(-1 * calc(1rem * 0.6));
  top: -0.4rem;
  color: #828282;
  padding-right: 1em;
  background: #ffffff;
  font-size: 0.6692rem;
  text-transform: uppercase;
}

.dropdown__menu .dropdown__list .dropdown__divider.dropdown__divider--no-name {
  margin: calc(1rem * 0.4) 0;
}

.dropdown__menu .dropdown__list .dropdown__divider.dropdown__divider--no-name .dropdown__divider__label {
  display: none;
}

.dropdown__menu.dropdown__menu--open .dropdown__list {
  display: block;
  animation: fadeIn 200ms ease-out;
}
</style>
