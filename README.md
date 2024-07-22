# ⚡️🦾 Spark Keepers ⚡️🦾

This repository contains all Keepers used in the Spark ecosystem to executed automated transactions. Powered by Gelato.

## 🏎️😤 TLDR

1. Make sure to have `yarn` and `node` installed
2. Run `yarn install` to install dependencies
3. Run `yarn test` to run tests
4. Set all necessary environment variables
5. Run `yarn gelato:ipfs <NAME_OF_THE_KEEPER_CODE_FOLDER>` for every keeper type
6. Run `yarn gelato:deploy` to deploy all of the keepers

## ⚙️🧰 Project Setup

### ✏️ Prerequisites

In order to install the project and run scripts you need to have `node` and `yarn` installed on your machine.
There are no specific versioning requirements, but version `node 20.12.2` and `yarn 1.22.19` are proved to be working.

### 🗜️ Install project dependencies

```
yarn install
```

### 📚 Configure your local environment:

Create your own `.env` file and complete it with these settings

```bash
ALCHEMY_ID= # API key used to create forked test environments
PRIVATE_KEY= # API key used to create forked test environments
GELATO_KEYSTORE_PATH= # absolute path to a keystore wallet that will manage your deployments
GELATO_PASSWORD_PATH= # absolute path to a keystore wallet password
GELATO_KEEPERS_SLACK_WEBHOOK_URL= # Slack Webhook URL that will be used by the keepers to send notifications
GELATO_KEEPERS_ETHERSCAN_API_KEY= # paid Etherscan API key that will be used by the keepers to query historical gas prices
```

Additionally if you don't have these variables set in your environment, add:

```bash
MAINNET_RPC_URL= # complete Ethereum Mainnet RPC URL that will be used for keeper deployments
GNOSIS_CHAIN_RPC_URL= # complete Gnosis Chain RPC URL that will be used for keeper deployments
```

## ⚖️👀 Testing

In order to run all the tests, run:

```bash
yarn test
```

Alternatively, in order to run only part of the tests, run on of the following:

```bash
yarn test:mainnet # tests on mainnet fork for keepers operating on mainnet
yarn test:gnosis # tests on gnosis chain fork for keepers operating on gnosis chain
yarn test:utils # tests of utils, not executed on forked environment
```

## 🚢🚀 Deployment

Deployment of a keeper consists of 2 subsequent steps.

1. The code of the keeper has to be uploaded to IPFS
2. An on-chain instance of a keeper running a code deployed at a specific IPFS address with proper arguments needs to be created and secrets needed to operate the keeper need to be set.

### 🌐 IPFS Deployment

The code of each of the keeper types needs to be separately deployed by running the following command:

```bash
yarn gelato:ipfs <NAME_OF_THE_KEEPER_CODE_FOLDER> # i.e. yarn gelato:ipfs governance-executor
```

As a result, the newly created IPFS deployment address will be stored in the `pre-deployments.json` file.

This command should be re-run for each of the keeper types, whenever there is a meaningful code change, that will require keeper redeployment.

### ⛓️ On-Chain Deployment

In order to spin-up operating instances of keepers running the code previously deployed to IPFS, run the following command (make sure to have all of the environment variables properly set):

```bash
yarn gelato:deploy
```

This script will check the contents of the `pre-deployments.json` file and the `deployments.json` file and determine for which keeper types to run the actual deployment script. The deployment will not be triggered if there is no IPFS deployment address for a given keeper, or the the IPFS deployment address in the `pre-deployments.json` file matches the one in the `deployments.json` file, which means, that this version of the keeper code was already deployed. Otherwise, the deployment will be performed.

The exact number of instances, their names, arguments, and configuration are defined in the script. The arguments used to spin-up the keeper are passed along with the deployment transaction and can only be changed by redeploying the keeper instance. Secrets are set in separate transactions, after the initial deployment and their value can be changed at any time via UI or a script.

Any time there is a need to deploy a keeper instance with a name that already occurs among the list of deployed and active keeper instances, the previously running one will be cancelled first.

All keepers when deployed get a tag with a date and time of the deployment for the easy of identification. This tag, despite being added to the instance name, doesn't interfere with detecting already deployed instances.

## 🪚🖍️ Misc

### 🔑 Key Check

In order to make sure that your keystore paths are configured correctly run:

```bash
yarn gelato:checkKey
```

This script will try to access the key that variables `GELATO_KEYSTORE_PATH` and `GELATO_PASSWORD_PATH` point to and will print the address that was decrypted

### 📜 Active Keepers List

In order to list all currently active Keepers run:

```bash
yarn gelato:list
```

This command will list all of the currently running Keepers' names and ids.
An example output:

```
== All Mainnet active tasks ==
    * 0x86a3b5ace771d3f72c3d503f404feda8498e619e779b9ff8cf704c1bb29f3c72 (Cap Automator <2024-07-05 12:39:41>)
    * 0xcf37bd51007aac73ec064210be4c36350c432041a47832d228d68f0607c5ea43 (D3M Ticker <2024-07-05 13:20:54>)
    * 0x588bb33b6febb264874f28910b393c7721058bf57e2facc20172e4c69545a9b5 (Kill Switch [WBTC-BTC] <2024-07-05 13:20:54>)
    * 0x28327d6869f95c33a60039adc1bdc2fe8b3d9a99233783d9c2be1aa91cd0705e (Kill Switch [stETH-ETH] <2024-07-05 13:20:54>)
    * 0xc5f5efc13488dba28a7b52825ac999e61ef1394364753c5edd52538455057466 (Kill Switch [Time Based] <2024-07-05 13:20:54>)
    * 0x2fa983a886a1be37c1c3cab81f0a7a8b53554f86969f39f877d5e02874514fd4 (Meta Morpho Cap Updater <2024-07-05 13:20:54>)
    * 0xb64de6a9f653235f3dd88792534fbb57a15929049468c0b376f6f0cd5426b8b2 (XChain Oracle Ticker [Event Based] <2024-07-05 13:20:54>)
    * 0x2cf5644493187b2790093ff7c881d73087fb876630193c78c23ac55daee405ab (XChain Oracle Ticker [Time Based] <2024-07-05 13:20:54>)
== All Gnosis active tasks ==
    * 0x95664d04fbc188fe4e322c40adeea7e8b58703360553db7676e4a0ec799dcd6c (Governance Executor [Gnosis] <2024-07-05 13:20:54>)
```
