<template>
    <modal title="Backup & Restore" v-model="showBackupAndRestoreModal" v-if="showBackupAndRestoreModal">
        <h3 style="margin-bottom: 1rem">Backup</h3>
        <div style="border: 1px solid var(--modal-border-color); padding: 1rem;">
            This backup will include your full application data (workspaces, requests, response history, open tabs, plugins etc).
            <div style="margin-top: 1rem">
                <button class="button" @click="exportBackup">Download Backup</button>
            </div>
        </div>

        <div style="margin-top: 1rem"></div>

        <h3 style="margin-bottom: 1rem">Restore</h3>
        <div style="border: 1px solid var(--modal-border-color); padding: 1rem;">
            <form @submit.prevent="restoreBackup">
                Restoring a backup will clear your current app data and restore the data saved in the backup!

                <div style="margin-top: 1rem">
                    <input type="file" @change="fileToRestore = $event.target.files[0]" accept=".json" required>
                </div>

                <div style="margin-top: 1.5rem;">
                    <button class="button">Restore Backup</button>
                </div>
            </form>
        </div>
    </modal>
</template>

<script>
import Modal from '@/components/Modal.vue'
import { importDB, exportDB } from '@/db'
import { downloadBlob, todayISODate } from '@/helpers'

export default {
    components: {
        Modal
    },
    data() {
        return {
            fileToRestore: null,
        }
    },
    computed: {
        showBackupAndRestoreModal: {
            get() {
                return this.$store.state.showBackupAndRestoreModal
            },
            set(value) {
                this.$store.commit('showBackupAndRestoreModal', value)
            }
        }
    },
    methods: {
        async exportBackup() {
            const blob = await exportDB()
            downloadBlob(`Restfox_Backup_${todayISODate()}.json`, blob)
        },
        async restoreBackup() {
            if(!await window.createConfirm('Are you sure?')) {
                return
            }

            try {
                await importDB(this.fileToRestore)
                this.$toast.success('Backup restored successfully')
            } catch(e) {
                console.log(e)
                this.$toast.error('Invalid backup file given')
            }
        }
    }
}
</script>
