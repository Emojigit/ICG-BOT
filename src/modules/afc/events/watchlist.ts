/* eslint-disable no-jquery/no-class-state */
import Discord from 'discord.js';
import EventSource from 'eventsource';

import { turndown, htmlToIRC, mwbot, $ } from '../util.js';
import { autoreview, issuesData } from '../autoreview';
import { send } from '../msg';
import winston from 'winston';

const RTRC = new EventSource( 'https://stream.wikimedia.org/v2/stream/recentchange' );

function getReason( $e: JQuery, title: string ) {
	$e.find( 'a' ).each( function ( _i, a ) {
		const $a: JQuery<HTMLAnchorElement> = $( a );
		const url = new URL( $a.get( 0 ).href, `https://zh.wikipedia.org/wiki/${ title }` );
		$a.text( `<a href="${ url.href }">${ $a.text() }</a>` );
	} );

	console.log( $( '<div>' ).append( $e.clone() ).html() );

	$e.find( '.hide-when-compact, .date-container, .mbox-image a, hr' ).remove();

	const $ambox = $e.find( 'table.ambox' ).remove();

	let text = $e.text().trim() + ( $ambox ? '\r• ' + $ambox.find( '.mbox-text-span' ).text().trim().split( /。/g ).join( '。\r• ' ) : '' );
	const $li = $e.find( 'li' );

	if ( $li ) {
		$li.each( ( _i, ele ) => {
			const eleText = $( ele ).text();
			text = text.replace(
				eleText,
				`${ eleText }\r• `
			);
		} );
	}

	return text
		.split( /\r•/g )
		.map( function ( x ) {
			return x.trim()
				.replace( /此條目/g, '草稿' )
				.replace( /條目/g, '草稿' )
				.replace( /\n/g, '' )
				.replace( /\r/g, '\n' )
				.replace( /\n• (?:$|\n)/g, '' );
		} )
		.filter( function ( x ) {
			return x.length && x !== '。';
		} )
		.map( function ( x ) {
			return x.split( /[。！？]/g )[ 0 ] + '。';
		} );
}

function htmllink( title: string, text?: string ) {
	return `<a href="https://zh.wikipedia.org/wiki/${ encodeURIComponent( title ) }">${ text || title }</a>`;
}

function mdlink( title: string, text?: string ) {
	return `[${ text || title }](https://zh.wikipedia.org/wiki/${ encodeURIComponent( title ) })`;
}

RTRC.onmessage = async function ( event ) {
	const data = JSON.parse( event.data );
	if (
		data.wiki !== 'zhwiki' ||
		data.type !== 'categorize' ||
		data.title !== 'Category:正在等待審核的草稿'
	) {
		return;
	}

	console.log( data.user, data.comment );

	const title: string = data.comment.replace( /^\[\[:?([^[\]]+)\]\].*$/, '$1' );

	// if (status == "removed") return; // 稍後處理
	const { user } = data;

	const page = new mwbot.page( title );
	// console.log(page)
	const creator = await page.getCreator();
	await page.purge();
	let tMsg = htmllink( `User:${ user }`, user );
	const dMsg = new Discord.MessageEmbed();

	const wikitext = await page.text();
	const html = await mwbot.parseWikitext( wikitext, {
		title: title,
		uselang: 'zh-hant'
	} );
	const $parseHTML = $( $.parseHTML( html ) );
	const $submissionbox = $parseHTML.find( '.afc-submission-pending' ).length ?
		$parseHTML.find( '.afc-submission-pending' ).first() :
		$parseHTML.find( '.afc-submission' ).first();

	if ( !$submissionbox.length && page.namespace === 0 && user !== creator ) {
		tMsg += `已接受${ htmllink( `User:${ encodeURI( creator ) }`, creator ) }的草稿${ htmllink( title ) }`;
		let tpClass: string;
		try {
			const talkPage = await mwbot.read( page.getTalkPage() );
			tpClass = talkPage.revisions[ 0 ].content.match( /\|class=([^|]*?)\|/ )[ 1 ];
		} catch ( e ) {
			tpClass = '';
		}
		let cClass = '';
		switch ( tpClass ) {
			case 'B':
				cClass = '乙';
				break;
			case 'C':
				cClass = '丙';
				break;
			case 'start':
				cClass = '初';
				break;
			case 'stub':
				cClass = '小作品';
				break;
			case 'list':
				cClass = '列表';
				break;
		}
		if ( cClass.length > 0 ) {
			tMsg += `（${ cClass }級）`;
		}
		dMsg
			.setColor( 'GREEN' )
			.setDescription( turndown( tMsg ) );

		winston.debug( `[afc/events/autoreview.js] comment: ${ data.comment }, user: ${ user }, title: ${ title }, creator: ${ creator }, action: accept, tpClass: ${ tpClass.length && tpClass || undefined }` );
	} else if ( !$submissionbox.length && page.namespace === 0 && user === creator ) {
		const pagehistory = await page.history( 'user', 2 );
		if ( pagehistory.length === 1 ) {
			const movequery = new URLSearchParams( {
				wpOldTitle: title,
				wpNewTitle: `Draft:${ title }`,
				wpReason: '由[[Wikipedia:建立條目|建立條目精靈]]建立但錯誤放置在主名字空間且未符合條目收錄要求的草稿'
			} );
			const moveurl = `https://zh.wikipedia.org/wiki/Special:MovePage?${ movequery.toString() }`;
			tMsg += `在條目命名空間建立了草稿${ htmllink( title ) }（<a href="${ moveurl }">移動到草稿命名空間</a>）`;
			dMsg
				.setDescription( `${ mdlink( `User:${ user }`, user ) }在條目命名空間建立了草稿${ mdlink( title ) }` )
				.setFooter( [ `[移動到草稿命名空間](${ moveurl })` ] );

			winston.debug( `[afc/events/autoreview.js] comment: ${ data.comment }, user: ${ user }, title: ${ title }, creator: ${ creator }, action: create in ns0` );
		} else {
			tMsg += `移除了在條目命名空間的草稿${ htmllink( title ) }中的AFC模板。`;
			dMsg.setDescription( turndown( tMsg ) );
			winston.debug( `[afc/events/autoreview.js] comment: ${ data.comment }, user: ${ user }, title: ${ title }, creator: ${ creator }, action: remove afc template & in ns0` );
		}
		dMsg.setColor( 'ORANGE' );
	} else if ( !$submissionbox.length && page.namespace !== 0 ) {
		tMsg += `移除了${ htmllink( `User:${ encodeURI( creator ) }`, creator ) }的草稿${ htmllink( title ) }的AFC模板。`;
		dMsg
			.setColor( 'ORANGE' )
			.setDescription( turndown( tMsg ) );

		winston.debug( `[afc/events/autoreview.js] comment: ${ data.comment }, user: ${ user }, title: ${ title }, creator: ${ creator }, action: remove afc template & not in ns0` );
	} else if ( $submissionbox.hasClass( 'afc-submission-pending' ) ) {
		tMsg += '提交了';
		if ( creator !== user ) {
			tMsg += `${ htmllink( `User:${ encodeURI( creator ) }`, creator ) }建立的`;
		}
		tMsg += `草稿${ htmllink( title ) }。`;

		const { issues } = await autoreview( wikitext, $parseHTML );
		winston.debug( `[afc/events/autoreview.js] comment: ${ data.comment }, user: ${ user }, title: ${ title }, creator: ${ creator }, action: submit, issues: ${ issues.join( ', ' ) }` );

		dMsg.setDescription( turndown( tMsg ) );

		tMsg += '\n\n<b>自動檢測問題</b>';

		if ( issues && issues.length > 0 ) {
			tMsg += issues.map( function ( x ) {
				return `\n• ${ issuesData[ x ] } (${ x })`;
			} ).join( '' );
			dMsg
				.setColor( 'RED' )
				.addField( '自動檢測問題', issues.map( function ( x ) {
					return `• ${ turndown( issuesData[ x ] ) } (${ x })`;
				} ) );
		} else {
			tMsg += '\n• 沒有發現顯著問題。';
			dMsg
				.setColor( 'GREEN' )
				.addField( '自動檢測問題', [ '• 沒有發現顯著問題。' ] );
		}
	} else if ( $submissionbox.hasClass( 'afc-submission-declined' ) || $submissionbox.hasClass( 'afc-submission-rejected' ) ) {
		tMsg += '將';
		if ( wikitext.match( /\|u=([^|]+)\|/ ) ) {
			const submituser = wikitext.match( /\|u=([^|]+)\|/ )[ 1 ];
			tMsg += `提交者${ htmllink( `User:${ encodeURI( submituser ) }`, creator ) }所提交的`;
		} else {
			tMsg += `建立者${ htmllink( `User:${ encodeURI( creator ) }`, creator ) }的`;
		}
		tMsg += `草稿${ htmllink( title ) }標記為`;
		if ( $submissionbox.hasClass( 'afc-submission-rejected' ) ) {
			tMsg += '拒絕再次提交的草稿';
		} else {
			tMsg += '仍需改善的草稿';
		}

		dMsg.setDescription( turndown( `<b>${ tMsg }</b>` ) );

		const $reasonbox = $submissionbox.find( '.afc-submission-reason-box' );
		let reasons: string[] = [];
		if ( $reasonbox.children().length ) {
			dMsg.setDescription( turndown( tMsg ) );

			$reasonbox.children().each( function ( _i, $e ) {
				if ( $( $e ).children().length > 1 && $( $e ).children().length === $( $e ).children( 'table, hr' ).length ) {
					$( $e ).children().each( function ( _ei, $ee ) {
						console.log( $( '<div>' ).append( $( $ee ).clone() ).html() );
						const res = getReason( $( $ee ), title );
						console.log( res );

						reasons = Array.prototype.concat( reasons, res );
					} );
				} else {
					console.log( $( '<div>' ).append( $( $e ).clone() ).html() );
					const res = getReason( $( $e ), title );
					console.log( res );

					reasons = Array.prototype.concat( reasons, res );
				}
			} );
		}

		winston.debug( `[afc/events/autoreview.js] comment: ${ data.comment }, user: ${ user }, title: ${ title }, creator: ${ creator }, action: ${ $submissionbox.hasClass( 'afc-submission-rejected' ) ? 'rejected' : 'declined' }, issues: ${ JSON.stringify( reasons ) }` );

		if ( reasons.length ) {
			dMsg.setDescription( turndown( tMsg ) );
			tMsg += '，理由：' + reasons.map( function ( x ) {
				return `\n• ${ x }`;
			} ).join( '' );
			dMsg.addField( '拒絕理由', reasons.map( function ( x ) {
				return `• ${ turndown( x ) }`;
			} ) );
		} else {
			tMsg += '，未提供理由。';
			dMsg.addField( '拒絕理由', [ '• 未提供理由' ] );
		}
	} else {
		winston.debug( `[afc/events/autoreview.js] comment: ${ data.comment }, user: ${ user }, title: ${ title }, creator: ${ creator }, action: ignore` );
		return;
	}

	const iMsg = htmlToIRC( tMsg );

	send( {
		dMsg,
		tMsg,
		iMsg
	} );
};
