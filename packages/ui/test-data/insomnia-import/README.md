# Insomnia import fixtures

The gRPC fixtures are Insomnia exports found in public repositories, saved unchanged, for the Insomnia import tests in `src/helpers.spec.ts`.

| file | what it is | source |
|---|---|---|
| `grpc-proto-directories.v4.json` | v4 JSON export with HTTP requests and gRPC requests whose proto files sit in an imported folder tree (`proto/greet/v1/greet.proto`, `proto/templateconnectgo/v1/store.proto`) | [MatsuoTakuro/my-template-connect-go `Insomnia/template-connect-go.json`](https://github.com/MatsuoTakuro/my-template-connect-go/blob/14264ca8282549408abfe86f19b3abcf0ce9ccec/Insomnia/template-connect-go.json) |
| `grpc-metadata-and-http.v4.json` | v4 JSON export with HTTP requests in folders and gRPC requests using one proto file added on its own, some with disabled metadata that holds an environment variable | [vezril/apollo-storage `insomnia/apollostorage.insomnia_collection.json`](https://github.com/vezril/apollo-storage/blob/e72378d4491406342fa22dae0b32ecf218cd93f1/insomnia/apollostorage.insomnia_collection.json) |
| `grpc-unspecified-address.v4.json` | v4 JSON export of gRPC requests to `0.0.0.0:50051` with no scheme, which Insomnia calls without TLS | [drop-the-code/ecommerce_cart `resources/Insomnia_gRPC_ecommerce_cart.json`](https://github.com/drop-the-code/ecommerce_cart/blob/2f00c68d81089c3529a3478e03d9f1b18fbd7489/resources/Insomnia_gRPC_ecommerce_cart.json) |
| `grpc-address-in-environment.v4.json` | v4 JSON export of gRPC requests whose address is an environment variable, and whose method names have no leading slash | [chavezag/hackathon-farinter `docs/insomnia-grpc-collection.json`](https://github.com/chavezag/hackathon-farinter/blob/4f2eadfad343bd4953eb8938c91699294a899cba/docs/insomnia-grpc-collection.json) |
| `grpc.v5.yaml` | v5 YAML export of gRPC requests only, which refer to a proto file the v5 format leaves out | [ab-dauletkhan/vektor_tms `Insomnia.yaml`](https://github.com/ab-dauletkhan/vektor_tms/blob/eae08755c927d1d26782ba3b5ab216b492fe37e6/Insomnia.yaml) |
