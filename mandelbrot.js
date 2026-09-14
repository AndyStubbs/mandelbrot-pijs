$.ready( function() {
	const INITIAL_CENTER_X = -0.75;
	const INITIAL_CENTER_Y = 0.0;
	const INITIAL_SPAN_Y = 2.625;

	const TILE_WIDTH = 64;
	const TILE_HEIGHT = 32;
	const FRAME_BUDGET = 9;
	const PASSES = [ 4, 2, 1 ];
	const SCIENTIFIC_ZOOM_THRESHOLD = 100000000000000;

	let centerX = INITIAL_CENTER_X;
	let centerY = INITIAL_CENTER_Y;
	let spanY = INITIAL_SPAN_Y;

	let renderToken = 0;
	let selecting = false;
	let selectStartX = 0;
	let selectStartY = 0;
	let selectionRect = null;
	let selectionBacking = null;
	let statusMessage = "";

	function onResize() {
		cancelSelection();
		startRender();
	}

	const screen = $.screen( {
		"aspect": "640e480",
		"resizeCallback": onResize
	} );
	screen.setFont( 3 );

	const palette = [ "#000000" ];

	for( let i = 0; i < 96; i++ ) {
		const t = i / 95;
		const r = Math.floor( 9 * ( 1 - t ) * t * t * t * 255 );
		const g = Math.floor( 15 * ( 1 - t ) * ( 1 - t ) * t * t * 255 );
		const b = Math.floor( 8.5 * ( 1 - t ) * ( 1 - t ) * ( 1 - t ) * t * 255 );

		palette.push(
			"#" +
			r.toString( 16 ).padStart( 2, "0" ) +
			g.toString( 16 ).padStart( 2, "0" ) +
			b.toString( 16 ).padStart( 2, "0" )
		);
	}

	screen.setPal( palette );
	screen.setBgColor( "#000000" );
	screen.setContainerBgColor( "#000000" );

	function getBounds() {
		const width = screen.width();
		const height = screen.height();
		const spanX = spanY * width / height;

		return {
			left: centerX - spanX / 2,
			top: centerY - spanY / 2,
			spanX: spanX,
			spanY: spanY,
			width: width,
			height: height
		};
	}

	function getZoomScale() {
		return INITIAL_SPAN_Y / spanY;
	}

	function formatZoomScale() {
		const zoom = getZoomScale();

		if( zoom >= SCIENTIFIC_ZOOM_THRESHOLD ) {
			return zoom.toExponential( 2 ) + "x";
		}

		return zoom.toLocaleString( undefined, {
			minimumFractionDigits: 0,
			maximumFractionDigits: 2
		} ) + "x";
	}

	function drawHud() {
		screen.setColor( "#000000" );
		screen.rect( 5, 5, 260, statusMessage ? 30 : 18, "#000000" );

		screen.setColor( "#FFFFFF" );
		screen.setPosPx( 8, 8 );
		screen.print( "Zoom: " + formatZoomScale() );

		if( statusMessage ) {
			screen.setPosPx( 8, 20 );
			screen.print( statusMessage );
		}
	}

	function getMaxIterations() {
		const zoom = INITIAL_SPAN_Y / spanY;

		return Math.min(
			1400,
			Math.floor(
				128 + Math.max( 0, Math.log2( zoom ) ) * 32
			)
		);
	}

	function mandelbrotColor( cx, cy, maxIterations ) {
		const xMinusQuarter = cx - 0.25;
		const q = xMinusQuarter * xMinusQuarter + cy * cy;

		if( q * ( q + xMinusQuarter ) <= 0.25 * cy * cy ) {
			return 1;
		}

		const xPlusOne = cx + 1;

		if( xPlusOne * xPlusOne + cy * cy <= 0.0625 ) {
			return 1;
		}

		let zx = 0;
		let zy = 0;
		let zx2 = 0;
		let zy2 = 0;
		let iteration = 0;

		while( zx2 + zy2 <= 4 && iteration < maxIterations ) {
			zy = 2 * zx * zy + cy;
			zx = zx2 - zy2 + cx;

			zx2 = zx * zx;
			zy2 = zy * zy;
			iteration++;
		}

		if( iteration === maxIterations ) {
			return 1;
		}

		return 2 + iteration % ( palette.length - 1 );
	}

	function makeTiles( width, height ) {
		const tiles = [];

		for( let y = 0; y < height; y += TILE_HEIGHT ) {
			for( let x = 0; x < width; x += TILE_WIDTH ) {
				const tileWidth = Math.min( TILE_WIDTH, width - x );
				const tileHeight = Math.min( TILE_HEIGHT, height - y );

				const centerDX = x + tileWidth / 2 - width / 2;
				const centerDY = y + tileHeight / 2 - height / 2;

				tiles.push( {
					x: x,
					y: y,
					width: tileWidth,
					height: tileHeight,
					distance: centerDX * centerDX + centerDY * centerDY
				} );
			}
		}

		tiles.sort( function( a, b ) {
			return a.distance - b.distance;
		} );

		return tiles;
	}

	function renderTile( tile, step, bounds, maxIterations ) {
		const data = new Array( tile.height );

		for( let y = 0; y < tile.height; y++ ) {
			data[y] = new Array( tile.width );
		}

		for( let localY = 0; localY < tile.height; localY += step ) {
			for( let localX = 0; localX < tile.width; localX += step ) {
				const sampleX = Math.min( bounds.width - 1, tile.x + localX + step * 0.5 );
				const sampleY = Math.min( bounds.height - 1, tile.y + localY + step * 0.5 );

				const cx = bounds.left + sampleX / bounds.width * bounds.spanX;
				const cy = bounds.top + sampleY / bounds.height * bounds.spanY;

				const color = mandelbrotColor( cx, cy, maxIterations );

				const blockWidth = Math.min( step, tile.width - localX );
				const blockHeight = Math.min( step, tile.height - localY );

				for( let by = 0; by < blockHeight; by++ ) {
					const row = data[localY + by];

					for( let bx = 0; bx < blockWidth; bx++ ) {
						row[localX + bx] = color;
					}
				}
			}
		}

		screen.put( data, tile.x, tile.y, true );
	}

	function startRender() {
		const token = ++renderToken;
		const bounds = getBounds();
		const maxIterations = getMaxIterations();
		const tiles = makeTiles( bounds.width, bounds.height );

		let passIndex = 0;
		let tileIndex = 0;

		screen.cls();
		drawHud();

		function renderFrame() {
			if( token !== renderToken || selecting ) {
				return;
			}

			const startTime = performance.now();

			while( performance.now() - startTime < FRAME_BUDGET ) {
				if( tileIndex >= tiles.length ) {
					passIndex++;
					tileIndex = 0;

					if( passIndex >= PASSES.length ) {
						drawHud();
						return;
					}
				}

				renderTile(
					tiles[tileIndex],
					PASSES[passIndex],
					bounds,
					maxIterations
				);

				tileIndex++;
			}

			drawHud();
			requestAnimationFrame( renderFrame );
		}

		requestAnimationFrame( renderFrame );
	}

	function getSelectionRect( x, y ) {
		const width = screen.width();
		const height = screen.height();

		x = Math.max( 0, Math.min( width - 1, x ) );
		y = Math.max( 0, Math.min( height - 1, y ) );

		const dx = x - selectStartX;
		const dy = y - selectStartY;

		const directionX = dx < 0 ? -1 : 1;
		const directionY = dy < 0 ? -1 : 1;

		let scale = Math.max(
			Math.abs( dx ) / width,
			Math.abs( dy ) / height
		);

		const availableX = directionX > 0 ? width - 1 - selectStartX : selectStartX;
		const availableY = directionY > 0 ? height - 1 - selectStartY : selectStartY;

		const maximumScale = Math.min(
			availableX / width,
			availableY / height
		);

		scale = Math.min( scale, maximumScale );

		const rectWidth = width * scale;
		const rectHeight = height * scale;

		return {
			x: directionX > 0 ? selectStartX : selectStartX - rectWidth,
			y: directionY > 0 ? selectStartY : selectStartY - rectHeight,
			width: rectWidth,
			height: rectHeight,
			scale: scale
		};
	}

	function restoreSelectionBacking() {
		if( selectionBacking !== null ) {
			screen.drawImage(
				selectionBacking,
				0,
				0,
				null,
				0,
				0
			);
		}
	}

	function drawSelection() {
		if( selectionRect === null ) {
			return;
		}

		restoreSelectionBacking();

		screen.setColor( "#000000" );
		screen.rect(
			selectionRect.x - 1,
			selectionRect.y - 1,
			selectionRect.width + 2,
			selectionRect.height + 2
		);

		screen.setColor( "#FFFFFF" );
		screen.rect(
			selectionRect.x,
			selectionRect.y,
			selectionRect.width,
			selectionRect.height
		);
	}

	function removeSelectionBacking() {
		if( selectionBacking !== null ) {
			$.removeImage( selectionBacking );
			selectionBacking = null;
		}
	}

	function cancelSelection() {
		if( selecting ) {
			restoreSelectionBacking();
		}

		selecting = false;
		selectionRect = null;

		removeSelectionBacking();
	}

	function beginSelection( x, y ) {
		renderToken++;

		removeSelectionBacking();

		selectStartX = Math.max( 0, Math.min( screen.width() - 1, x ) );
		selectStartY = Math.max( 0, Math.min( screen.height() - 1, y ) );

		selectionBacking = $.createImageFromScreen(
			"mandelbrot-selection",
			0,
			0,
			screen.width() - 1,
			screen.height() - 1
		);

		selecting = true;
		selectionRect = null;
	}

	function finishSelection() {
		if( !selecting ) {
			return;
		}

		const rect = selectionRect;

		restoreSelectionBacking();

		selecting = false;
		selectionRect = null;

		removeSelectionBacking();

		if( rect === null || rect.scale < 0.001 ) {
			statusMessage = "Zoom area not accepted";
			startRender();
			return;
		}

		const bounds = getBounds();

		const rectCenterX = rect.x + rect.width / 2;
		const rectCenterY = rect.y + rect.height / 2;

		centerX = bounds.left + rectCenterX / bounds.width * bounds.spanX;
		centerY = bounds.top + rectCenterY / bounds.height * bounds.spanY;

		spanY = bounds.spanY * rect.height / bounds.height;

		statusMessage = "";
		startRender();
	}

	$.onpress( "down", function( press ) {
		if( press.buttons > 0 ) {
			beginSelection(
				press.x,
				press.y
			);
		}
	} );

	$.onpress( "move", function( press ) {
		if( !selecting ) {
			return;
		}

		if( press.buttons === 0 ) {
			finishSelection();
			return;
		}

		selectionRect = getSelectionRect(
			press.x,
			press.y
		);

		drawSelection();
	} );

	$.onpress( "up", function() {
		finishSelection();
	} );

	$.onkey( "r", "down", function() {
		cancelSelection();

		centerX = INITIAL_CENTER_X;
		centerY = INITIAL_CENTER_Y;
		spanY = INITIAL_SPAN_Y;
		statusMessage = "";

		startRender();
	} );

	startRender();
} );
