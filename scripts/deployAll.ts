import * as fs from 'fs'
import * as readline from 'readline'
import { ethers } from 'ethers'
import { AutomateSDK, TaskTransaction, TriggerType, Web3Function } from '@gelatonetwork/automate-sdk'

import { dsNoteAbi, oracleAbi, oracleAggregatorAbi } from '../abis'
import { addresses } from '../utils'

const hourInMilliseconds = 1000 * 60 * 60
const fiveMinutesInMilliseconds = 1000 * 60 * 5

const weekInSeconds = 60 * 60 * 24 * 7

const prompter = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
})

const pause = () => {
    return new Promise<void>((resolve) => {
        prompter.question('Press ENTER to confirm & continue...', () => {
            resolve()
        })
    })
}

console.log('== Preparing a deployment of all the keeper actions ==')

const keystorePath = process.argv[2] || (process.env.KEYSTORE_PATH as string)
const passwordPath = process.argv[3] || (process.env.PASSWORD_PATH as string)

const password = passwordPath ? fs.readFileSync(passwordPath, 'utf8').slice(0, -1) : ''
const keystore = fs.readFileSync(keystorePath, 'utf8')
const deployer = ethers.Wallet.fromEncryptedJsonSync(keystore, password)

const slackWebhookUrl = process.env.GELATO_KEEPERS_SLACK_WEBHOOK_URL
if (!slackWebhookUrl) {
    console.error('Set a valid value for GELATO_KEEPERS_SLACK_WEBHOOK_URL')
    process.exit(1)
}

const etherscanApiKey = process.env.GELATO_KEEPERS_ETHERSCAN_API_KEY
if (!etherscanApiKey) {
    console.error('Set a valid value for GELATO_KEEPERS_ETHERSCAN_API_KEY')
    process.exit(1)
}

const mainnetRpcUrl = process.env.MAINNET_RPC_URL
if (!mainnetRpcUrl) {
    console.error('Set a valid value for MAINNET_RPC_URL')
    process.exit(1)
}

const gnosisRpcUrl = process.env.GNOSIS_CHAIN_RPC_URL
if (!gnosisRpcUrl) {
    console.error('Set a valid value for GNOSIS_CHAIN_RPC_URL')
    process.exit(1)
}

console.log('   * Deployer:          ', deployer.address)
console.log('   * Slack Webhook URL: ', slackWebhookUrl)
console.log('   * Etherscan API Key: ', etherscanApiKey)
console.log('   * Mainnet RPC URL:   ', mainnetRpcUrl)
console.log('   * Gnosis RPC URL:    ', gnosisRpcUrl)

const mainnetDeployer = new ethers.Wallet(deployer.privateKey, new ethers.providers.JsonRpcProvider(mainnetRpcUrl))
const gnosisDeployer = new ethers.Wallet(deployer.privateKey, new ethers.providers.JsonRpcProvider(gnosisRpcUrl))

const mainnetAutomation = new AutomateSDK(1, mainnetDeployer)
const mainnetManagement = new Web3Function(1, mainnetDeployer)

const gnosisAutomation = new AutomateSDK(100, gnosisDeployer)
const gnosisManagement = new Web3Function(100, gnosisDeployer)

const ipfsDeployments = JSON.parse(fs.readFileSync('./scripts/pre-deployments.json'))
const gelatoDeployments = JSON.parse(fs.readFileSync('./scripts/deployments.json'))

const deploymentDate = new Date().toISOString()
const deploymentTag = ` <${deploymentDate.slice(0, 10)} ${deploymentDate.slice(11, 19)}>`

let ipfsDeployment: string
let gelatoDeployment: string

const deploy = async (w3fName: string, deploymentLogic: (ipfsDeployment: string) => Promise<void>) => {
    ipfsDeployment = ipfsDeployments[w3fName]
    gelatoDeployment = gelatoDeployments[w3fName]

    console.log(`\n== Deploying ${w3fName} ==`)

    if (ipfsDeployment == undefined) {
        console.log(`   * Skipping ${w3fName} deployment (no IPFS deployment found)`)
    } else if (ipfsDeployment == gelatoDeployment) {
        console.log(`   * Skipping ${w3fName} deployment (already deployed)`)
    } else {
        console.log(`   * Deployment of ${w3fName} to be executed (IPFS hash: ${ipfsDeployment})`)
        await pause()
        console.log(`   * Deploying ${w3fName}...`)
        await deploymentLogic(ipfsDeployment)
        console.log(`   * Deployed ${w3fName} successfully!`)

        gelatoDeployments[w3fName] = ipfsDeployment
        fs.writeFileSync('./scripts/deployments.json', JSON.stringify(gelatoDeployments, null, 4).concat('\n'))
    }
}

const retirePreviouslyDeployedTasks = async (automation: AutomateSDK, taskNames: Array<string>) => {
    const activeTasks = await automation.getActiveTasks()

    const tasksToRetire = activeTasks.filter((task) => taskNames.includes(task.name.slice(0, -deploymentTag.length)))

    for (const task of tasksToRetire) {
        console.log(`   * Retiring ${task.name}...`)
        const { tx } = await automation.cancelTask(task.taskId)
        await tx.wait()
        console.log(`   * ${task.name} retired successfully!`)
    }
}

;(async () => {
    await pause()

    // *****************************************************************************************************************
    // ********** CAP AUTOMATOR ****************************************************************************************
    // *****************************************************************************************************************
    await deploy('cap-automator', async (ipfsDeployment: string) => {
        const taskNames = ['Cap Automator']

        await retirePreviouslyDeployedTasks(mainnetAutomation, taskNames)

        const { taskId, tx }: TaskTransaction = await mainnetAutomation.createBatchExecTask({
            name: taskNames[0].concat(deploymentTag),
            web3FunctionHash: ipfsDeployment,
            web3FunctionArgs: {
                threshold: 5000, // less than 5.000bps (50%) of the gap left under the cap
                performGasCheck: true,
                sendSlackMessages: true,
            },
            trigger: {
                type: TriggerType.TIME,
                interval: hourInMilliseconds,
            },
        })

        await tx.wait()
        await mainnetManagement.secrets.set(
            {
                SLACK_WEBHOOK_URL: slackWebhookUrl,
                ETHERSCAN_API_KEY: etherscanApiKey,
            },
            taskId,
        )
    })

    // *****************************************************************************************************************
    // ********** D3M TICKER *******************************************************************************************
    // *****************************************************************************************************************
    await deploy('d3m-ticker', async (ipfsDeployment: string) => {
        const taskNames = ['D3M Ticker']

        await retirePreviouslyDeployedTasks(mainnetAutomation, taskNames)

        const { taskId, tx }: TaskTransaction = await mainnetAutomation.createBatchExecTask({
            name: taskNames[0].concat(deploymentTag),
            web3FunctionHash: ipfsDeployment,
            web3FunctionArgs: {
                threshold: '20000000000000000000000000', // 20M DAI (20.000.000e18 DAI)
                performGasCheck: true,
                sendSlackMessages: true,
            },
            trigger: {
                type: TriggerType.TIME,
                interval: hourInMilliseconds,
            },
        })

        await tx.wait()
        await mainnetManagement.secrets.set(
            {
                SLACK_WEBHOOK_URL: slackWebhookUrl,
                ETHERSCAN_API_KEY: etherscanApiKey,
            },
            taskId,
        )
    })

    // *****************************************************************************************************************
    // ********** GOVERNANCE EXECUTOR **********************************************************************************
    // *****************************************************************************************************************
    await deploy('governance-executor', async (ipfsDeployment: string) => {
        const taskNames = ['Governance Executor [Gnosis]']

        await retirePreviouslyDeployedTasks(gnosisAutomation, taskNames)

        const { taskId, tx }: TaskTransaction = await gnosisAutomation.createBatchExecTask({
            name: taskNames[0].concat(deploymentTag),
            web3FunctionHash: ipfsDeployment,
            web3FunctionArgs: {
                domain: 'gnosis',
                sendSlackMessages: true,
            },
            trigger: {
                type: TriggerType.TIME,
                interval: hourInMilliseconds,
            },
        })

        await tx.wait()
        await gnosisManagement.secrets.set(
            {
                SLACK_WEBHOOK_URL: slackWebhookUrl,
            },
            taskId,
        )
    })

    // *****************************************************************************************************************
    // ********** KILL SWITCH ******************************************************************************************
    // *****************************************************************************************************************
    await deploy('kill-switch', async (ipfsDeployment: string) => {
        const taskNames = ['Kill Switch [WBTC-BTC]', 'Kill Switch [stETH-ETH]', 'Kill Switch [Time Based]']

        await retirePreviouslyDeployedTasks(mainnetAutomation, taskNames)

        const aggregatorInterface = new ethers.utils.Interface(oracleAggregatorAbi)

        const wbtcBtcOracle = new ethers.Contract(addresses.mainnet.priceSources.wbtcBtc, oracleAbi, mainnetDeployer)
        const wbtcBtcAggregator = await wbtcBtcOracle.aggregator()

        const { taskId: wbtcBtcTaskId, tx: wbtcBtcTx }: TaskTransaction = await mainnetAutomation.createBatchExecTask({
            name: taskNames[0].concat(deploymentTag),
            web3FunctionHash: ipfsDeployment,
            web3FunctionArgs: {
                sendSlackMessages: true,
            },
            trigger: {
                type: TriggerType.EVENT,
                filter: {
                    address: wbtcBtcAggregator,
                    topics: [[aggregatorInterface.getEventTopic('AnswerUpdated')]],
                },
                blockConfirmations: 0,
            },
        })

        await wbtcBtcTx.wait()
        await mainnetManagement.secrets.set(
            {
                SLACK_WEBHOOK_URL: slackWebhookUrl,
            },
            wbtcBtcTaskId,
        )

        const stethEthOracle = new ethers.Contract(addresses.mainnet.priceSources.stethEth, oracleAbi, mainnetDeployer)
        const stethEthAggregator = await stethEthOracle.aggregator()

        const { taskId: stethEthTaskId, tx: stethEthTx }: TaskTransaction = await mainnetAutomation.createBatchExecTask(
            {
                name: taskNames[1].concat(deploymentTag),
                web3FunctionHash: ipfsDeployment,
                web3FunctionArgs: {
                    sendSlackMessages: true,
                },
                trigger: {
                    type: TriggerType.EVENT,
                    filter: {
                        address: stethEthAggregator,
                        topics: [[aggregatorInterface.getEventTopic('AnswerUpdated')]],
                    },
                    blockConfirmations: 0,
                },
            },
        )

        await stethEthTx.wait()
        await mainnetManagement.secrets.set(
            {
                SLACK_WEBHOOK_URL: slackWebhookUrl,
            },
            stethEthTaskId,
        )

        const { taskId: timeBasedTaskId, tx: timeBasedTx }: TaskTransaction =
            await mainnetAutomation.createBatchExecTask({
                name: taskNames[2].concat(deploymentTag),
                web3FunctionHash: ipfsDeployment,
                web3FunctionArgs: {
                    sendSlackMessages: true,
                },
                trigger: {
                    type: TriggerType.TIME,
                    interval: fiveMinutesInMilliseconds,
                },
            })

        await timeBasedTx.wait()
        await mainnetManagement.secrets.set(
            {
                SLACK_WEBHOOK_URL: slackWebhookUrl,
            },
            timeBasedTaskId,
        )
    })

    // *****************************************************************************************************************
    // ********** META MORPHO ******************************************************************************************
    // *****************************************************************************************************************
    await deploy('meta-morpho', async (ipfsDeployment: string) => {
        const taskNames = ['Meta Morpho Cap Updater']

        await retirePreviouslyDeployedTasks(mainnetAutomation, taskNames)

        const { taskId, tx }: TaskTransaction = await mainnetAutomation.createBatchExecTask({
            name: taskNames[0].concat(deploymentTag),
            web3FunctionHash: ipfsDeployment,
            web3FunctionArgs: {
                sendSlackMessages: true,
            },
            trigger: {
                type: TriggerType.TIME,
                interval: hourInMilliseconds,
            },
        })

        await tx.wait()
        await mainnetManagement.secrets.set(
            {
                SLACK_WEBHOOK_URL: slackWebhookUrl,
            },
            taskId,
        )
    })

    // *****************************************************************************************************************
    // ********** XCHAIN ORACLE TICKER *********************************************************************************
    // *****************************************************************************************************************
    await deploy('xchain-oracle-ticker', async (ipfsDeployment: string) => {
        const taskNames = ['XChain Oracle Ticker [Event Based]', 'XChain Oracle Ticker [Time Based]']

        await retirePreviouslyDeployedTasks(mainnetAutomation, taskNames)

        const dsNoteInterface = new ethers.utils.Interface(dsNoteAbi)

        const { taskId: eventTaskId, tx: eventTx }: TaskTransaction = await mainnetAutomation.createBatchExecTask({
            name: taskNames[0].concat(deploymentTag),
            web3FunctionHash: ipfsDeployment,
            web3FunctionArgs: {
                maxDelta: weekInSeconds.toString(),
                gasLimit: '800000',
                sendSlackMessages: true,
            },
            trigger: {
                type: TriggerType.EVENT,
                filter: {
                    address: addresses.mainnet.pauseProxy,
                    topics: [[dsNoteInterface.getEventTopic('LogNote')]],
                },
                blockConfirmations: 0,
            },
        })

        await eventTx.wait()
        await mainnetManagement.secrets.set(
            {
                SLACK_WEBHOOK_URL: slackWebhookUrl,
            },
            eventTaskId,
        )

        const { taskId: timeTaskId, tx: timeTx }: TaskTransaction = await mainnetAutomation.createBatchExecTask({
            name: taskNames[1].concat(deploymentTag),
            web3FunctionHash: ipfsDeployment,
            web3FunctionArgs: {
                maxDelta: weekInSeconds.toString(),
                gasLimit: '800000',
                sendSlackMessages: true,
            },
            trigger: {
                type: TriggerType.TIME,
                interval: fiveMinutesInMilliseconds,
            },
        })

        await timeTx.wait()
        await mainnetManagement.secrets.set(
            {
                SLACK_WEBHOOK_URL: slackWebhookUrl,
            },
            timeTaskId,
        )
    })

    prompter.close()
})()
