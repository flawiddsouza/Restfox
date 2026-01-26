# cURL Import Test Fixtures

This directory contains test fixtures for testing the cURL import functionality.

## Structure

Each test case is a subdirectory containing:

- **`input.txt`** (required) - The raw cURL command to test. Paste curl commands here exactly as-is, no escaping needed.
- **`expected.json`** (required) - The expected parsed output (partial match using `toMatchObject`)
- **`name.txt`** (optional) - Custom test name. If not provided, uses the directory name.

## Adding a New Test Case

1. Create a new directory: `mkdir my-test-case`
2. Add the curl command: `echo "curl ..." > my-test-case/input.txt`
3. Run the test once to see what it produces, then create `expected.json` with the expected output
4. (Optional) Add a custom name: `echo "My Test Case #123" > my-test-case/name.txt`

## Example

```
curl/
  issue-366/
    input.txt       # Raw curl command
    expected.json   # Expected parsed result
    name.txt        # "Correctly handles @ symbol in JSON body #366"
```

The test will automatically be discovered and run with the name from `name.txt`.
