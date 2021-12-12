<template>
    <div class="dropdown__menu theme--dropdown__menu dropdown__menu--open" aria-hidden="false">
        <div class="dropdown__backdrop theme--transparent-overlay"></div>
        <div tabindex="-1" class="dropdown__list" style="left: 303.422px; right: initial; top: 140.672px; bottom: initial; min-width: initial; max-width: 197px; max-height: 316.328px;">
            <div class="form-control dropdown__filter">
                <i class="fa fa-search"></i>
                <input type="text">
            </div>
            <ul class="">
                <li>
                    <div class="dropdown__divider">
                        <span class="dropdown__divider__label">
                            <span>
                                <i class="fa fa-bars"></i> Structured </span>
                        </span>
                    </div>
                </li>
                <li data-filter-index="2" class="">
                    <button type="button" value="multipart/form-data">
                        <div class="dropdown__inner">
                            <div class="dropdown__text">
                                <i class="fa fa-empty"></i>Multipart Form
                            </div>
                        </div>
                    </button>
                </li>
                <li data-filter-index="3" class="">
                    <button type="button" value="application/x-www-form-urlencoded">
                        <div class="dropdown__inner">
                            <div class="dropdown__text">
                                <i class="fa fa-check"></i>Form URL Encoded
                            </div>
                        </div>
                    </button>
                </li>
                <li data-filter-index="4" class="">
                    <button type="button" value="application/graphql">
                        <div class="dropdown__inner">
                            <div class="dropdown__text">
                                <i class="fa fa-empty"></i>GraphQL Query
                            </div>
                        </div>
                    </button>
                </li>
                <li>
                    <div class="dropdown__divider">
                        <span class="dropdown__divider__label">
                            <span>
                                <i class="fa fa-code"></i> Text </span>
                        </span>
                    </div>
                </li>
                <li data-filter-index="6" class="">
                    <button type="button" value="application/json">
                        <div class="dropdown__inner">
                            <div class="dropdown__text">
                                <i class="fa fa-empty"></i>JSON
                            </div>
                        </div>
                    </button>
                </li>
                <li data-filter-index="7" class="">
                    <button type="button" value="application/xml">
                        <div class="dropdown__inner">
                            <div class="dropdown__text">
                                <i class="fa fa-empty"></i>XML
                            </div>
                        </div>
                    </button>
                </li>
                <li data-filter-index="8" class="">
                    <button type="button" value="text/yaml">
                        <div class="dropdown__inner">
                            <div class="dropdown__text">
                                <i class="fa fa-empty"></i>YAML
                            </div>
                        </div>
                    </button>
                </li>
                <li data-filter-index="9" class="">
                    <button type="button" value="application/edn">
                        <div class="dropdown__inner">
                            <div class="dropdown__text">
                                <i class="fa fa-empty"></i>EDN
                            </div>
                        </div>
                    </button>
                </li>
                <li data-filter-index="10" class="">
                    <button type="button" value="text/plain">
                        <div class="dropdown__inner">
                            <div class="dropdown__text">
                                <i class="fa fa-empty"></i>Plain
                            </div>
                        </div>
                    </button>
                </li>
                <li data-filter-index="11" class="">
                    <button type="button" value="">
                        <div class="dropdown__inner">
                            <div class="dropdown__text">
                                <i class="fa fa-empty"></i>Other
                            </div>
                        </div>
                    </button>
                </li>
                <li>
                    <div class="dropdown__divider">
                        <span class="dropdown__divider__label">
                            <span>
                                <i class="fa fa-ellipsis-h"></i> Other </span>
                        </span>
                    </div>
                </li>
                <li data-filter-index="13" class="">
                    <button type="button" value="application/octet-stream">
                        <div class="dropdown__inner">
                            <div class="dropdown__text">
                                <i class="fa fa-empty"></i>Binary File
                            </div>
                        </div>
                    </button>
                </li>
                <li data-filter-index="14" class="">
                    <button type="button">
                        <div class="dropdown__inner">
                            <div class="dropdown__text">
                                <i class="fa fa-empty"></i>No Body
                            </div>
                        </div>
                    </button>
                </li>
            </ul>
        </div>
    </div>
</template>

<style scoped>
ul {
    list-style: none;
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
  border: 1px solid var(--hl-sm);
  box-shadow: 0 0 1rem 0 rgba(0, 0, 0, 0.1);
  box-sizing: border-box;
  background: var(--color-bg);
  margin: var(--padding-xxs) 3px;
  padding-top: var(--radius-md);
  padding-bottom: var(--radius-md);
  border-radius: var(--radius-md);
  overflow: auto;
}

.dropdown__menu .dropdown__list .dropdown__filter {
  border: 1px solid var(--hl-md);
  margin: var(--padding-xs);
  width: auto;
  border-radius: var(--radius-sm);
  display: flex;
  flex-direction: row;
  align-items: center;
  padding-left: var(--padding-sm);
  position: absolute;
  left: -9999999px;
  color: var(--hl);
}

.dropdown__menu .dropdown__list .dropdown__filter input {
  margin: 0;
  padding: var(--padding-xs) var(--padding-sm);
  color: var(--color-font);
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
  color: var(--hl-xl);
  margin-left: auto;
  padding-left: var(--padding-lg);
}

.dropdown__menu .dropdown__list li > button {
  min-width: 15rem;
  font-size: var(--font-size-md);
  text-align: left;
  padding-right: var(--padding-md);
  padding-left: var(--padding-sm);
  height: var(--line-height-xs);
  width: 100%;
  display: block;
  color: var(--color-font) !important;
  white-space: nowrap;
  margin: 0;
}

.dropdown__menu .dropdown__list li > button i.fa:first-child {
  display: inline-block;
  width: 2.2em;
  text-align: center;
}

.dropdown__menu .dropdown__list li > button:hover:not(:disabled),
.dropdown__menu .dropdown__list li.active > button:not(:disabled) {
  background: var(--hl-sm);
}

.dropdown__menu .dropdown__list li > button:active:not(:disabled) {
  background: var(--hl-md);
}

.dropdown__menu .dropdown__list .dropdown__divider {
  border-bottom: 1px solid var(--hl-lg);
  overflow: visible !important;
  height: 0;
  margin: var(--padding-md) var(--padding-md) var(--padding-md) var(--padding-md);
}

.dropdown__menu .dropdown__list .dropdown__divider .dropdown__divider__label {
  position: relative;
  left: calc(-1 * var(--padding-sm));
  top: -0.7rem;
  color: var(--hl);
  padding-right: 1em;
  background: var(--color-bg);
  font-size: var(--font-size-xs);
  text-transform: uppercase;
}

.dropdown__menu .dropdown__list .dropdown__divider.dropdown__divider--no-name {
  margin: var(--padding-xs) 0;
}

.dropdown__menu .dropdown__list .dropdown__divider.dropdown__divider--no-name .dropdown__divider__label {
  display: none;
}

.dropdown__menu.dropdown__menu--open .dropdown__list {
  display: block;
  animation: fadeIn 200ms ease-out;
}
</style>
