const fs = require('fs').promises
import { readdirIgnoreError, pathExists } from './file-utils'

describe('readdirIgnoreError', () => {
    it('should return an array of directory contents when readdir succeeds', async () => {
        // Arrange
        const path = '/path/to/directory'
        const expectedContents = ['file1.txt', 'file2.txt', 'file3.txt']
        vi.spyOn(fs, 'readdir').mockResolvedValue(expectedContents)

        // Act
        const result = await readdirIgnoreError(path)

        // Assert
        expect(result).toEqual(expectedContents)
        expect(fs.readdir).toHaveBeenCalledWith(path)
    })

    it('should return an empty array when readdir throws an error', async () => {
        // Arrange
        const path = '/path/to/directory'
        vi.spyOn(fs, 'readdir').mockRejectedValue(new Error('Failed to read directory'))

        // Act
        const result = await readdirIgnoreError(path)

        // Assert
        expect(result).toEqual([])
        expect(fs.readdir).toHaveBeenCalledWith(path)
    })
})

describe('pathExists', () => {
    it('should return true when fs.access resolves', async () => {
        // Arrange
        const path = '/path/to/file'
        vi.spyOn(fs, 'access').mockResolvedValue(undefined)

        // Act
        const result = await pathExists(path)

        // Assert
        expect(result).toBe(true)
        expect(fs.access).toHaveBeenCalledWith(path)
    })

    it('should return false when fs.access rejects', async () => {
        // Arrange
        const path = '/path/to/file'
        vi.spyOn(fs, 'access').mockRejectedValue(new Error('File does not exist'))

        // Act
        const result = await pathExists(path)

        // Assert
        expect(result).toBe(false)
        expect(fs.access).toHaveBeenCalledWith(path)
    })
})

