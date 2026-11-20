import {NextResponse} from 'next/server';
import {verifySolar} from '../../../server/verify';
export const runtime='nodejs';
export async function POST(request:Request){
 if(Number(request.headers.get('content-length')||0)>11*1024*1024)return NextResponse.json({error:'File too large'},{status:413});
 try{return NextResponse.json(await verifySolar(await request.formData()));}catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Verification failed'},{status:400});}
}
