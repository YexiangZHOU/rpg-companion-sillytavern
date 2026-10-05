import * as native from '../../../../../stable-diffusion/index.js';
import { SlashCommandParser } from '../../../../../../slash-commands/SlashCommandParser.js';
import { withAvatarJob } from './avatarQueue.mjs';
import { nativeImagePool } from './imagePool.mjs';

/** The patched OpenAI native module snapshots settings per request. Other providers keep the safe serialized command path. */
export function concurrentNativeImages(){return !!native.supportsConcurrentImageGeneration?.();}
export async function generateNativeImage(prompt,{valid=()=>true,width,height}={}) {
    if(concurrentNativeImages())return nativeImagePool.run(()=>native.generateQuietImage(prompt,{valid,width,height}),valid);
    return withAvatarJob(async()=>{
        const command=SlashCommandParser.commands?.sd??SlashCommandParser.commands?.imagine;
        if(!command?.callback)throw Error('Native image module unavailable');
        const args={quiet:'true',extend:'false',gallery:'false'};
        if(width)args.width=String(width);if(height)args.height=String(height);
        const result=await command.callback(args,prompt);
        return typeof result==='string'?result:result?.pipe;
    },valid);
}
