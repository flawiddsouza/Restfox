<template>
    <div v-if="showModalComp" class="help-modal">
        <modal :title="title" v-model="showModalComp">
            <p>Use <a href="http://goessner.net/articles/JsonPath/">JSONPath</a> to filter the response body. Here are some examples that you might use on a book store API:</p>
            <table style="table-layout: fixed">
                <tr v-for="(example, index) in jsonPathExamples" :key="index">
                    <td>
                        <code class="code-block">{{ example.path }}</code>
                    </td>
                    <td>
                        {{ example.description }}
                    </td>
                </tr>
            </table>
            <p>Note that there's no standard for JSONPath. Restfox uses <a href="https://www.npmjs.com/package/jsonpath-plus">jsonpath-plus</a>.</p>
        </modal>
    </div>
</template>

<script>
import Modal from '@/components/Modal.vue'

export default {
    components: {Modal},
    props: {
        showModal: Boolean,
    },
    computed: {
        title() {
            return 'Response Filtering Help'
        },
        showModalComp: {
            get() {
                return this.showModal
            },
            set(value) {
                this.$emit('update:showModal', value)
            }
        },
        jsonPathExamples() {
            return [
                {
                    path: '$.store.books[*].title',
                    description: 'Get titles of all books in the store'
                },
                {
                    path: '$.store.books[?(@.price < 10)].title',
                    description: 'Get books costing less than $10'
                },
                {
                    path: '$.store.books[-1:]',
                    description: 'Get the last book in the store'
                },
                {
                    path: '$.store.books.length',
                    description: 'Get the number of books in the store'
                },
                {
                    path: '$.store.books[?(@.title.match(/lord.*rings/i))]',
                    description: 'Get book by title regular expression'
                }
            ]
        }
    },
}
</script>
<style>
.code-block {
    background-color: #f4f4f4;
    padding: 0.5rem;
    border-radius: 4px;
    font-family: 'Courier New', Courier, monospace;
}
.help-modal {
    z-index: 1001;
}
</style>
