import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import readline from 'readline'

import { providers, utils, Wallet } from 'ethers'
import {
    AutomateSDK,
    Secrets,
    TriggerConfig,
    TriggerType,
    Web3Function,
    Web3FunctionUserArgs,
} from '@gelatonetwork/automate-sdk'

import { listDirectories, listJsonFiles } from './utils'

dotenv.config()

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//// CONSTANTS & TYPES /////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

const w3fImplementationsPath = './web3-functions'
const w3fConfigsPath = './scripts/configs'
const w3fIpfsDeploymentsPath = './scripts/pre-deployments.json'
const abisPath = './abis'

const domains = ['mainnet', 'gnosis']
type Domain = (typeof domains)[number]

const triggerTypeNames = ['block', 'cron', 'event', 'time']

type BlockTrigger = {
    type: 'block'
}

type CronTrigger = {
    type: 'cron'
    cron: string
}

type EventTrigger = {
    type: 'event'
    filter: {
        address: string
        topics: Array<{
            abiName: string
            eventName: string
        }>
    }
    blockConfirmations: number
}

type TimeTrigger = {
    type: 'time'
    interval: number
}

type Trigger = BlockTrigger | CronTrigger | EventTrigger | TimeTrigger

type DeploymentConfig = {
    domain: Domain
    args: object
    secrets: object
    trigger: Trigger
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//// HELPER FUNCTIONS //////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

const createTriggerConfig = (trigger: Trigger): TriggerConfig => {
    if (trigger.type === 'block') return { type: TriggerType.BLOCK }

    if (trigger.type === 'cron') return { type: TriggerType.CRON, cron: trigger.cron }

    if (trigger.type === 'event') {
        let topics: Array<string> = []

        for (const topic of trigger.filter.topics) {
            const abi = JSON.parse(fs.readFileSync(path.join(abisPath, topic.abiName + '.json')))
            const contractInterface = new utils.Interface(abi)
            topics.push(contractInterface.getEventTopic(topic.eventName))
        }

        return {
            type: TriggerType.EVENT,
            filter: {
                address: trigger.filter.address,
                topics: [topics],
            },
            blockConfirmations: Number(trigger.blockConfirmations),
        }
    }

    if (trigger.type === 'time') return { type: TriggerType.TIME, interval: Number(trigger.interval) }

    throw new Error('Unknown trigger type')
}

const retrievePrivateKeyFromKeystore = (keystorePath: string, passwordPath: string): string => {
    const password = passwordPath ? fs.readFileSync(passwordPath, 'utf8').slice(0, -1) : ''
    const keystore = fs.readFileSync(keystorePath, 'utf8')
    return Wallet.fromEncryptedJsonSync(keystore, password).privateKey
}

const getBufferFromString = (str: string): Buffer => {
    return Buffer.from(str, 'utf-8')
}

const createHash = (rawConfig: Buffer, ipfsDeployment: string): string => {
    const configHash = utils.keccak256(rawConfig)
    const ipfsDeploymentHash = utils.keccak256(getBufferFromString(ipfsDeployment))
    return utils.keccak256(getBufferFromString(configHash.concat(ipfsDeploymentHash)))
}

const pause = () => {
    return new Promise<void>((resolve) => {
        prompter.question('Press ENTER to confirm & continue...', () => {
            resolve()
        })
    })
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//// SCRIPT SETUP //////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

const keystorePath = process.env.GELATO_KEYSTORE_PATH as string
const passwordPath = process.env.GELATO_PASSWORD_PATH as string
const envPrivateKey = process.env.GELATO_PRIVATE_KEY as string
const mainnetRpcUrl = process.env.MAINNET_RPC_URL as string
const gnosisRpcUrl = process.env.GNOSIS_CHAIN_RPC_URL as string

const deployerPrivateKey =
    envPrivateKey || (keystorePath && passwordPath && retrievePrivateKeyFromKeystore(keystorePath, passwordPath))

if (!deployerPrivateKey) throw new Error('Private key is not configured')

const deployerWallets: Record<Domain, Wallet> = {
    mainnet: new Wallet(deployerPrivateKey, new providers.JsonRpcProvider(mainnetRpcUrl)),
    gnosis: new Wallet(deployerPrivateKey, new providers.JsonRpcProvider(gnosisRpcUrl)),
}

const automationSDKs: Record<Domain, AutomateSDK> = {
    mainnet: new AutomateSDK(1, deployerWallets.mainnet),
    gnosis: new AutomateSDK(100, deployerWallets.gnosis),
}

const managementSDKs: Record<Domain, Web3Function> = {
    mainnet: new Web3Function(1, deployerWallets.mainnet),
    gnosis: new Web3Function(100, deployerWallets.gnosis),
}

const prompter = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
})

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//// EXECUTION /////////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

;(async () => {
    const w3fNames = listDirectories(w3fImplementationsPath)
    const w3fConfigs = listDirectories(w3fConfigsPath)
    const ipfsDeployments = JSON.parse(fs.readFileSync(w3fIpfsDeploymentsPath))

    let oldTasks: Record<string, { taskId: string; domain: string }> = {}
    for (const domain of domains) {
        const tasks = await automationSDKs[domain].getActiveTasks()
        if (tasks.length === 0) continue
        for (const task of tasks) {
            oldTasks[task.name] = { taskId: task.taskId, domain }
        }
    }

    for (const w3fName of w3fNames) {
        if (!w3fConfigs.includes(w3fName)) {
            console.log(`No configs for ${w3fName}`)
            continue
        }
        if (!ipfsDeployments[w3fName]) {
            console.log(`No IPFS deployment for ${w3fName}`)
            continue
        }

        const configFileNames = listJsonFiles(path.join(w3fConfigsPath, w3fName))
        if (configFileNames.length == 0) {
            console.log(`No configs for ${w3fName}`)
            continue
        }

        console.log(`Deploying ${w3fName}`)

        for (const configFileName of configFileNames) {
            const rawConfig = fs.readFileSync(path.join(w3fConfigsPath, w3fName, configFileName))
            const config = JSON.parse(rawConfig) as DeploymentConfig

            if (!domains.includes(config.domain)) {
                console.log(`Domain ${config.domain} is not supported`)
                continue
            }
            if (!triggerTypeNames.includes(config.trigger.type)) {
                console.log(`Trigger type ${config.trigger.type} is not supported`)
                continue
            }

            const configName = configFileName.slice(0, -5) // remove '.json'
            const hash = createHash(rawConfig, ipfsDeployments[w3fName])
            const deploymentName = `${configName} ${hash}`

            if (oldTasks[deploymentName]) {
                console.log(`Task ${deploymentName} is already active`)
                delete oldTasks[deploymentName]
                continue
            }

            const userArgs = config.args as Web3FunctionUserArgs
            const triggerConfig = createTriggerConfig(config.trigger)
            const secrets: Secrets = Object.entries(config.secrets).reduce((secrets, [key, envVarName]) => {
                const value = process.env[envVarName]
                if (!value) throw new Error(`${envVarName} env variable is not defined`)
                secrets[key] = value
                return secrets
            }, {} as Record<string, string>)

            console.log(`Deploying ${deploymentName}`)
            await pause()
            const { taskId, tx }: TaskTransaction = await automationSDKs[config.domain].createBatchExecTask({
                name: deploymentName,
                web3FunctionHash: ipfsDeployments[w3fName],
                web3FunctionArgs: userArgs,
                trigger: triggerConfig,
            })
            await tx.wait()
            await managementSDKs[config.domain].secrets.set(secrets, taskId)
        }
    }

    for (const [taskName, task] of Object.entries(oldTasks)) {
        console.log(`Cancelling task ${taskName}`)
        const { tx } = await automationSDKs[task.domain].cancelTask(task.taskId)
        await tx.wait()
    }

    prompter.close()
})()
