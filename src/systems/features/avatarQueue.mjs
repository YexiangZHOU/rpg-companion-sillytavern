// Native image commands temporarily override shared sd settings. Serialize the
// whole prompt+image job across player and NPC portraits, including navigation.
let tail=Promise.resolve();
export async function withAvatarJob(work,valid=()=>true) {
    const previous=tail;let release;
    tail=new Promise(resolve=>{release=resolve;});
    await previous;
    try {if(!valid())return null;return await work();}
    finally {release();}
}
