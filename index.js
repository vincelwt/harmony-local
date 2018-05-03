const dialog = remote.dialog
const recursive = require('recursive-readdir')
const mm = require('music-metadata')
const imgFolder = remote.app.getPath('userData')+'/Artworks'


/** 
Get the metadatas of a disk file
@param filename: the path of the file
@param callback: function to call when over
**/

const getTrackMetadatas = (filename) => {

	return new Promise((resolve, reject) => {

		mm.parseFile(filename, { duration: true }).then(metadata => {

			const id = new Buffer(filename).toString('base64')

			getArtworkPath(metadata, artwork => {

				let tempTrack

				if (!metadata.common.title || metadata.common.title === "") {
					// No metadata were found

					let title = (process.platform == "win32" ? filename.split("\\").pop() : filename.split('/').pop())

					tempTrack = {
						service: 'local',
						title: title,
						share_url: `https://www.youtube.com/results?search_query=${encodeURIComponent(title)}`,
						artist: {
							name: '',
							id: ''
						},
						album: {
							name: '',
							id: ''
						},
						trackNumber: '',
						id: id,
						duration: metadata.format.duration * 1000,
						artwork: artwork,
						stream_url: `file://${filename}`
					}

				} else {
					metadata.common.album = metadata.common.album || ''
					metadata.common.artist = metadata.common.artist || ''
					
					const ytLookup = metadata.common.artist + " " + metadata.common.title
					
					let noMultiplier = (metadata.common.disk ? metadata.common.disk.no : 1)

					tempTrack = {
						service: 'local',
						title: metadata.common.title,
						share_url: `https://www.youtube.com/results?search_query=${encodeURIComponent(ytLookup)}`,
						artist: {
							name: metadata.common.artist,
							id: metadata.common.artist
						},
						trackNumber: noMultiplier * metadata.common.track.no,
						album: {
							name: metadata.common.album,
							id: md5(metadata.common.artist+metadata.common.album)
						},
						id: id,
						duration: metadata.format.duration * 1000,
						artwork: artwork,
						stream_url: `file://${filename}`
					}
				}

				if (tempTrack.duration === 0) {
					getAudioDuration(tempTrack.stream_url, duration => {
						tempTrack.duration = duration
						resolve(tempTrack)
					})
				} else {
					resolve(tempTrack)
				}
				
			})

		}).catch(err => {
			console.error(err)

			let title = (process.platform == "win32" ? filename.split("\\").pop() : filename.split('/').pop())

			tempTrack = {
				'service': 'local',
				'title': title,
				'share_url': `https://www.youtube.com/results?search_query=${encodeURIComponent(title)}`,
				'artist': {
					'name': '',
					'id': ''
				},
				'album': {
					'name': '',
					'id': ''
				},
				'trackNumber': '',
				'id': id,
				'duration': 0,
				'artwork': artwork,
				'stream_url': `file://${filename}`
			}

			getAudioDuration(tempTrack.stream_url, duration => {
				tempTrack.duration = duration
				resolve(tempTrack)
			})


		})

	})
}

const getArtworkPath = (metadata, callback)  => {
	if (!('picture' in metadata.common) || !metadata.common.picture.length) return callback('')

	let picture = metadata.common.picture[0]
	let artwork = URL.createObjectURL(new Blob([picture.data], { 'type': 'image/' + picture.format}))

	let reader = new window.FileReader()
	reader.readAsDataURL(new Blob([picture.data])) 
	reader.onloadend = () => {
		rawImage = reader.result
		let base64Data = rawImage.replace("data:base64,", "").replace("data:;base64,", "")
		const imgPath = imgFolder+"/"+md5(rawImage)+'.'+picture.format

		if (!fs.existsSync(imgPath)) {
			fs.writeFile(imgPath, base64Data, 'base64', (err) => {
				if (err) {
					console.error(err)
					return callback('')
				}

				callback(imgPath)
			})
		} else {
			callback(imgPath)
		}
	}
}

const resetImgFolder = () => {
	
	if( fs.existsSync(imgFolder) ) {

		fs.readdirSync(imgFolder).forEach( (file, index) => {
			let curPath = imgFolder + "/" + file
			fs.unlinkSync(curPath) // Delete file
		})
		
		fs.rmdirSync(imgFolder)
	}

	fs.mkdirSync(imgFolder)

}

/** 
Get the duration of an audio track, used when the metadata parsing for the duratio  failed.
@param path: the path of the file
@param callback: function to call when over
**/
const getAudioDuration = (path, callback) => {
	const audio = new Audio

	audio.addEventListener('loadedmetadata', () => {
		callback(audio.duration*1000)
	})

	audio.addEventListener('error', e => {
		console.warn('Could not get duration from '+path)
		callback(0)
	})

	audio.preload = 'metadata'
	audio.src = path
}


class Local {

	/**
	 * Fetch data
	 * @param callback
	 * @returns {Promise}
	 */
	static fetchData (callback) {

		resetImgFolder()

		let temp
		
		if (!store.get("localPlaylistFavs")) {
			temp = {
				service: 'local',
				title: 'Favorites',
				artwork: '',
				icon: 'heart',
				id: 'favs',
				tracks: []
			}

			store.set("localPlaylistFavs", temp)
		} else {

			temp = store.get("localPlaylistFavs")
		}

		Data.addPlaylist(temp, _ => {

			Data.addPlaylist({
				service: 'local',
				title: 'Library',
				artwork: '',
				icon: 'drive',
				id: 'library',
				tracks: []
			}, (err, library) => {

				if (err) return callback(err)

				const supportedTypes = ['mp3', "wav", "flac", "ogg", "m4a"]

				let tempTracks = []

				recursive(settings.local.paths[0], (err, files) => {

					if (!files) {
						settings.local.error = true
						return reject([err, true])
					}

					let finishNow = false
					let musicFiles = []

					for (let file of files) {
						const fileExtension = file.split('.').slice(-1)[0].toLowerCase()

						if (supportedTypes.includes(fileExtension)) {
							musicFiles.push(file)
						}
					}

					let promises = musicFiles.map(getTrackMetadatas); // Convert each file to promise with it's metadatas and execute it later

					Promise.all(promises).then(tempTracks => {

						library.tracks = sortBy(tempTracks, 'artist')
						library.save()

						callback()

					})

				})
			})
		})
	}

	/**
	* Called when user wants to activate the service
	*
	* @param callback {Function} Callback function
	*/

	static login (callback) {

		settings.local.paths = dialog.showOpenDialog({
			properties: ['openDirectory']
		})

		if (settings.local.paths == undefined) return callback("No path selected")

		callback()

	}

	/**
	 * Like a song
	 * @param track {Object} The track object
	 */
	static like (track, callback) {
		this.toggleLike(callback)
	}

	/**
	 * Unlike a song
	 * @param track {Object} The track object
	 */
	static unlike (track, callback) {
		this.toggleLike(callback)
	}

	/**
	 * Toggle the like status on a local song
	 */
	static toggleLike (callback) {
		Data.findOne({ service: 'local', id: 'favs' }, (err, doc) => {
			if (err) callback(err)
				
			store.set("localPlaylistFavs", doc) // We only need to save the playlist
		})
	}

	/**
	 * Get the streamable URL
	 *
	 * @param track {Object} The track object
	 * @param callback {Function} The callback function
	 */
	static getStreamUrl (track, callback) {
		callback(null, track.stream_url, track.id)
	}

	/**
	 * View the artist
	 *
	 * @param track {Object} The track object
	 */
	static viewArtist (tracks) {
		let track = tracks[0]
		let temp = []

		Data.findOne({service: 'local', id: 'library'}, (err, pl) => {
			for (let tr of pl.tracks)
				if (tr.artist.id == track.artist.id)
					temp.push(tr)

			specialView('local', temp, 'artist', track.artist.name)
		})

	}

	/**
	* View the album
	*
	* @param tracks {Array of Objects} The tracks object
	*/
	static viewAlbum (tracks) {
		let track = tracks[0]
		let temp = []

		Data.findOne({service: 'local', id: 'library'}, (err, pl) => {
			for (let tr of pl.tracks)
				if (tr.album.id == track.album.id)
					temp.push(tr)

			specialView('local', temp, 'album', track.album.name, track.artwork)
		})
	}

	/*
	* Returns the settings items of this plugin
	*
	*/
	static settingsItems () {
		return [
			{
				type: 'activate',
				id: 'active'
			},
			{
				type: 'html',
				content: settings.local && settings.local.active ? 'Selected path: '+settings.local.paths[0] : ''
			}
		]
	}

	/*
	* Returns the context menu items of this plugin
	*
	* @param tracks {Array of Objects} The selected tracks object
	*/
	static contextmenuItems (tracks) {
		return [
			{
				label: 'View artist',
				click: () => Local.viewArtist(tracks)
			},

			{
				label: 'View album',
				click: () => Local.viewAlbum(tracks)
			}
		]
	}

}

/** Static Properties **/
Local.favsPlaylistId = "favs"
Local.worksOffline = true
Local.scrobbling = true
Local.settings = {
	paths: [],
	active: false
}

module.exports = Local