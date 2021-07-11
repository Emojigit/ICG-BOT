import { BridgeMsg } from '../transport/BridgeMsg';

import { Manager } from '../../init';
import * as moduleTransport from '../transport';

import Discord from 'discord.js';

const dc = Manager.handlers.get( 'Discord' );
const tg = Manager.handlers.get( 'Telegram' );
const irc = Manager.handlers.get( 'IRC' );

type command = ( args: string[], replyfunc: ( msg: {
	dMsg: string | Discord.MessageEmbed;
	tMsg: string;
	iMsg: string;
} ) => void ) => void;

export function setCommand( cmd: string, func: command ): void {
	moduleTransport.addCommand( `!${ cmd }`, function ( bridgeMsg ) {
		func( bridgeMsg.param.split( ' ' ), function ( msg: {
			dMsg: string | Discord.MessageEmbed;
			tMsg: string;
			iMsg: string;
		} ) {
			reply( bridgeMsg, msg );
		} );
		return Promise.resolve();
	}, {
		enables: Manager.config.afc.enables.filter( function ( c ) {
			return BridgeMsg.parseUID( c ).client !== 'Telegram';
		} )
	} );

	moduleTransport.addCommand( `/${ cmd }`, function ( bridgeMsg ) {
		func( bridgeMsg.param.split( ' ' ), function ( msg: {
			dMsg: string | Discord.MessageEmbed;
			tMsg: string;
			iMsg: string;
		} ) {
			reply( bridgeMsg, msg );
		} );
		return Promise.resolve();
	}, {
		enables: Manager.config.afc.enables.filter( function ( c ) {
			return BridgeMsg.parseUID( c ).client !== 'IRC';
		} )
	} );
}

export async function reply( context: BridgeMsg, msg: {
	dMsg: string | Discord.MessageEmbed;
	tMsg: string;
	iMsg: string;
} ): Promise<void> {
	const that = BridgeMsg.parseUID( context.rawTo );

	if ( that.client === 'Discord' ) {
		dc.say( that.id, msg.dMsg );
	} else if ( that.client === 'Telegram' ) {
		tg.sayWithHTML( that.id, msg.tMsg, {
			disable_web_page_preview: true
		} );
	} else if ( that.client === 'IRC' ) {
		msg.iMsg.split( '\n' ).forEach( function ( m ) {
			irc.say( that.id, m );
		} );
	}

	// 若互聯且在公開群組調用，則讓其他群也看到
	if ( context.extra.mapto ) {
		await ( new Promise<void>( function ( resolve ) {
			setTimeout( function () {
				resolve();
			}, 1000 );
		} ) );

		for ( const t of context.extra.mapto ) {
			if ( t === context.to_uid ) {
				continue;
			}
			const s = BridgeMsg.parseUID( t );
			if ( s.client === 'Discord' ) {
				dc.say( s.id, msg.dMsg );
			} else if ( s.client === 'Telegram' ) {
				tg.sayWithHTML( s.id, msg.tMsg, {
					disable_web_page_preview: true
				} );
			} else if ( s.client === 'IRC' ) {
				msg.iMsg.split( '\n' ).forEach( function ( m ) {
					irc.say( s.id, m );
				} );
			}
		}
	}
}

export async function send( msg: {
	dMsg: string | Discord.MessageEmbed;
	tMsg: string;
	iMsg: string;
} ): Promise<void> {
	Manager.config.afc.enables.forEach( function ( k ) {
		const f = BridgeMsg.parseUID( k );
		if ( f.client === 'Discord' ) {
			dc.say( f.id, msg.dMsg );
		} else if ( f.client === 'Telegram' ) {
			tg.sayWithHTML( f.id, msg.tMsg, {
				disable_web_page_preview: true
			} );
		} else if ( f.client === 'IRC' ) {
			msg.iMsg.split( '\n' ).forEach( function ( m ) {
				irc.say( f.id, m );
			} );
		}
	} );
}
