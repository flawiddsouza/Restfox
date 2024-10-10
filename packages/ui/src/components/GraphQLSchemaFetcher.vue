<template>
    <div :class="{ 'overlay': true, 'active': isVisible }">
        <div class="sidebar-graphql">
            <button class="close-btn" @click="$emit('close')"><i class="fa fa-times"></i></button>
            <h2>Schema</h2>
            <div class="search-container">
                <input
                    type="text"
                    class="full-width-input"
                    v-model="searchQuery"
                    placeholder="Search the docs..."
                    style="margin-top: 1.5rem;"
                />
                <button class="button" style="margin-left: 0.5rem; margin-top: 1.5rem;" @click="clearSearch">Clear</button>
            </div>
            <div v-if="loading" class="loading">Loading...</div>
            <div v-if="error" class="error">{{ error }}</div>

            <div v-if="!searchQuery">
                <p>A GraphQL schema provides a root type for each kind of operation.</p>
                <h3>Root Types</h3>
                <ul class="root-types">
                    <li @click="setSearchQuery('Query')">
                        <span class="root-type-name">query:</span>
                        <span class="root-type-value" :style="{ color: getColorForType('OBJECT') }">Query</span>
                    </li>
                    <li @click="setSearchQuery('Mutation')">
                        <span class="root-type-name">mutation:</span>
                        <span class="root-type-value" :style="{ color: getColorForType('OBJECT') }">Mutation</span>
                    </li>
                </ul>
            </div>

            <!-- Search results when query is present -->
            <div v-if="searchQuery">
                <h3 style="padding-top: 1rem">Found Types</h3>
                <div v-if="filteredTypes.length > 0">
                    <div
                        v-for="type in filteredTypes"
                        :key="type.name"
                        class="type"
                        @click="toggleType(type.name)"
                    >
                        <span :style="{ color: getColorForType(type.kind) }">{{ type.name }}</span>
                        <span class="arrow" :class="{ open: openedTypes[type.name] }"></span>
                        <div v-if="openedTypes[type.name]" class="type-details">
                            <p>{{ type.description || 'No description available.' }}</p>
                            <ul>
                                <li v-for="field in type.fields || []" :key="field.name">
                                    <strong>{{ field.name }}</strong> : {{ field.type.name || field.type.kind }}
                                </li>
                            </ul>
                        </div>
                    </div>
                </div>
                <div v-else class="no-results">No matching types found.</div>

                <h3 style="padding-top: 1rem">Found Fields</h3>
                <div v-if="filteredFields.length > 0">
                    <div
                        v-for="field in filteredFields"
                        :key="field.fullName"
                        class="field"
                        @click="toggleField(field.fullName)"
                    >
                        <span :style="{ color: getColorForType(field.type.kind) }">{{ field.fullName }}</span>
                        <span class="arrow" :class="{ open: openedFields[field.fullName] }"></span>
                        <div v-if="openedFields[field.fullName]" class="field-details">
                            <p>No additional details available.</p>
                        </div>
                    </div>
                </div>
                <div v-else class="no-results">No matching fields found.</div>
            </div>
        </div>
    </div>
</template>

<script>
import { ref, onMounted, computed, watch } from 'vue'
import { gql, GraphQLClient } from 'graphql-request'
import { resolveAuthentication } from '@/helpers'

export default {
    name: 'SchemaSlideOut',
    props: {
        isVisible: {
            type: Boolean,
            required: true,
        },
        endpoint: {
            type: String,
            required: true,
        },
        collectionItem: {
            type: Object,
            required: true
        },
        collectionItemEnvironmentResolved: {
            type: Object,
            required: true
        },
        schemaAction: {
            type: [null, String],
            required: true,
        },
    },
    setup(props) {
        const schema = ref(null)
        const loading = ref(false)
        const error = ref(null)
        const searchQuery = ref('')
        const openedTypes = ref({})
        const openedFields = ref({})

        const toggleType = (typeName) => {
            openedTypes.value[typeName] = !openedTypes.value[typeName]
        }

        const toggleField = (fieldName) => {
            openedFields.value[fieldName] = !openedFields.value[fieldName]
        }

        const setSearchQuery = (query) => {
            searchQuery.value = query
        }

        const clearSearch = () => {
            searchQuery.value = ''
        }

        const fetchSchema = async() => {
            loading.value = true
            try {

                let headers = []

                if(props.collectionItem.authentication) {
                    headers['Authorization'] = resolveAuthentication(props.collectionItem.authentication, props.collectionItemEnvironmentResolved)
                }

                const graphQLClient = new GraphQLClient(props.endpoint, {
                    headers,
                })


                const query = gql`
          {
            __schema {
              types {
                name
                kind
                description
                fields {
                  name
                  type {
                    name
                    kind
                  }
                }
              }
            }
          }
        `
                const data = await graphQLClient.request(query)
                schema.value = data.__schema.types
                error.value = null
            } catch (err) {
                error.value = `Error fetching schema: ${err.message}`
            } finally {
                loading.value = false
            }
        }

        onMounted(() => {
            fetchSchema()
        })

        watch(
            () => props.schemaAction,
            (action) => {
                if (action === 'refresh-schema') {
                    fetchSchema()
                }
            }
        )

        const filteredTypes = computed(() =>
            schema.value?.filter((type) =>
                type.name.toLowerCase().includes(searchQuery.value.toLowerCase())
            ) || []
        )

        const filteredFields = computed(() => {
            const fields = []
            schema.value?.forEach((type) => {
                if (type.fields) {
                    type.fields.forEach((field) => {
                        const fullName = `${type.name}.${field.name}`
                        if (fullName.toLowerCase().includes(searchQuery.value.toLowerCase())) {
                            fields.push({
                                fullName,
                                type: field.type,
                            })
                        }
                    })
                }
            })
            return fields
        })

        const getColorForType = (kind) => {
            switch (kind) {
                case 'OBJECT':
                    return 'orange'
                case 'INTERFACE':
                    return 'blue'
                case 'UNION':
                    return 'purple'
                case 'ENUM':
                    return 'green'
                case 'INPUT_OBJECT':
                    return 'brown'
                case 'SCALAR':
                    return 'gray'
                default:
                    return `var(--button-text-color)`
            }
        }

        return {
            schema,
            loading,
            error,
            searchQuery,
            openedTypes,
            openedFields,
            toggleType,
            toggleField,
            setSearchQuery,
            clearSearch,
            filteredTypes,
            filteredFields,
            getColorForType,
        }
    },
}
</script>

<style scoped>
.overlay {
    position: fixed;
    top: 0;
    right: 0;
    width: 0;
    height: 100%;
    overflow-x: hidden;
    transition: 0.5s;
    z-index: 1;
    border: 1px solid var(--menu-border-color);
    box-shadow: 0 0 1rem 0 var(--box-shadow-color);
    border-radius: 0.3rem;
    padding-top: 5px;
    padding-bottom: 5px;
}

.overlay.active {
    width: 500px;
}

.sidebar-graphql {
    position: absolute;
    top: 0;
    right: 0;
    width: 500px;
    height: 100%;
    background: var(--background-color);
    padding: 20px;
    box-shadow: -2px 0 5px rgba(0, 0, 0, 0.5);
    overflow-y: auto;
}

.close-btn {
    position: absolute;
    top: 20px;
    right: 20px;
    font-size: 15px;
    cursor: pointer;
    background: none;
    border: none;
    color: var(--button-text-color);
}

.loading {
    color: blue;
}

.error {
    color: red;
}

.search-container {
    display: flex;
    align-items: center;
}

.type, .field {
    margin-bottom: 1em;
    font-size: 1em;
    cursor: pointer;
    position: relative;
    padding-right: 20px;
}

.arrow {
    border: solid var(--button-text-color);
    border-width: 0 3px 3px 0;
    display: inline-block;
    padding: 3px;
    margin-left: 5px;
    transition: transform 0.3s ease;
    transform: rotate(45deg);
    position: absolute;
    right: 0;
    top: 5px;
}

.arrow.open {
    transform: rotate(-135deg);
}

.root-types {
    list-style: none;
    padding: 0;
}

.root-type-name {
    font-weight: bold;
}

.root-type-value {
    font-style: italic;
    cursor: pointer;
    padding-left: 1rem;
}

.type-details, .field-details {
    margin-left: 10px;
    margin-top: 5px;
    border-left: 1px solid var(--default-border-color);
    padding-left: 10px;
    color: var(--text-color);
}

.no-results {
    font-style: italic;
    color: var(--default-border-color);
}
</style>
