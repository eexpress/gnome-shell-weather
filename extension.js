const { GObject, Clutter, St, Gio, GLib, Soup } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Me = ExtensionUtils.getCurrentExtension();
const _domain = Me.metadata['gettext-domain'];
const _ = ExtensionUtils.gettext;

const mlayout = Main.layoutManager;
const monitor = mlayout.primaryMonitor;
const ByteArray = imports.byteArray;
const size = 300;
let myX = 0;
let myY = 0;
const dMax = 10;
const dDef = 6;	 //解析数据时，第一次显示的缺省个数。
const dMin = 3;
let box = [];  //实际显示的图标，长度可变。
let w_icon = [];  //保留天气的图标序号，长度是 dMax。

let longitude = '112.903736';  //经度 longitude
let latitude = '28.218743';	 //纬度 latitude

function lg(s) { log("===" + _domain + "===>" + s); }

const useJsonOrSchemas = false;

const Indicator = GObject.registerClass(
	class Indicator extends PanelMenu.Button {
		_init() {
			super._init(0.0, _('Screen Weather'));

			this.locale = GLib.get_language_names()[0];	 // zh_CN
			this.settings = ExtensionUtils.getSettings();
			this.settings.connect('changed::latitude', () => {
				this.get_web();
			});

			this.get_web();

			this.stock_icon = new St.Icon({ gicon : this.local_gicon("1"), style_class : 'system-status-icon' });
			this.add_child(this.stock_icon);
			this.connect("button-press-event", this.click.bind(this));
			this.connect("scroll-event", this.scroll.bind(this));
		}

		click(actor, event) {
			if (myX == 0) {	 //点击一次后，才能算出面板图标的中心点座标。
				const [x, y] = global.get_pointer();
				const [op, x0, y0] = this.transform_stage_point(x, y);
				if (!op) return false;
				myX = x - x0 + this.width / 2;
				myY = y - y0 + this.height / 2;
			}
			switch (event.get_button()) {
			case 1:	 // show
				this.arrayBox();
				break;
			case 2:	 // refresh
				this.get_web();
				break;
			case 3:	 // dismiss
				this.dismissBox();
				break;
			}
			return Clutter.EVENT_STOP;
		};

		scroll(actor, event) {
			if (box.length < dMin) return Clutter.EVENT_STOP;
			switch (event.get_scroll_direction()) {
			case Clutter.ScrollDirection.UP:
			case Clutter.ScrollDirection.LEFT:
				if (box.length < dMax) {
					box.push(this.createBox(w_icon[box.length].toString()));
					this.arrayBox();
				}
				break;
			case Clutter.ScrollDirection.DOWN:
			case Clutter.ScrollDirection.RIGHT:
				if (box.length > dMin) {
					const c = box.pop();
					c.destroy();
					this.arrayBox();
				}
				break;
			default:
			}
			return Clutter.EVENT_PROPAGATE;
		};

		arrayBox() {
			const i = box.length;
			if (i < 1) return;
			const w = (i - 1) * size / 2 + size / 6 + size / 2;	 //第一个的中心到最后一个的右侧。
			let offX = myX;
			if (myX + w - size / 4 > monitor.width) {
				offX = monitor.width - w + size / 4;
			}
			if (offX < size / 2) offX = size / 2;
			for (let i in box) {
				this.easeMove(box[i], true, offX + (i == 0 ? 0 : size / 6) + i * size / 2, myY + size / 2 + this.height / 2);
			}
		};

		dismissBox() {
			if (box.length < 1) return;
			let offX;
			for (let a of box) {
				offX = Math.ceil(Math.random() * monitor.width);
				this.easeMove(a, false, offX, monitor.height);
			}
		};

		createBox(iconname) {
			let _size = size;
			if (box.length > 0) _size = size / 2;
			const icon = new St.Icon({ gicon : this.local_gicon(iconname), icon_size : _size });
			const _box = new Clutter.Actor({ name : iconname, reactive : true, width : _size, height : _size });
			_box.add_child(icon);
			_box.set_position(Math.ceil(Math.random() * monitor.width), monitor.height);
			_box.visible = false;
			_box.connect("button-press-event", this.click.bind(this));
			_box.connect("scroll-event", this.scroll.bind(this));
			mlayout.addChrome(_box);
			return _box;
		};

		parseWeather(json) {
			if (!json) return;
			for (let i of box)
				i.destroy();
			box = [];
			//~ lg("====>"+JSON.stringify(json.list[0].weather[0].icon, null, 4));
			w_icon = [];
			for (let i = 0; i < dMax; i++) {
				const jsonicon = json.list[i].weather[0].icon;
				const jsondesc = json.list[i].weather[0].description;
				//~ lg(jsondesc + ",\t" + jsonicon);
				if (jsonicon) {
					const d = parseInt(jsonicon);
					w_icon.push(d);
					if (box.length < dDef) box.push(this.createBox(d.toString()));
					if (i == 0) this.stock_icon.set_gicon(this.local_gicon(d.toString()));
				} else break;
			}
		};

		get_coord(){
			if (useJsonOrSchemas) {
				try {  // 在配置界面实现全兼容前，使用文件设置经纬度。
					const coordfile = Me.path + '/coord.json';
					if (GLib.file_test(coordfile, GLib.FileTest.IS_REGULAR)) {
						const [ok, content] = GLib.file_get_contents(coordfile);
						if (ok) {
							const obj = JSON.parse(ByteArray.toString(content));
							if (obj.latitude) latitude = obj.latitude;
							if (obj.longitude) longitude = obj.longitude;
						}
					}
				} catch (e) { throw e; }
			} else {
				latitude = this.settings.get_string('latitude');
				longitude = this.settings.get_string('longitude');
			}
		};

		get_web() {
			this.get_coord();
			if (! latitude || ! longitude) return;	//null, 0, ''
			let params = {
				APPID : 'c93b4a667c8c9d1d1eb941621f899bb8',
				exclude : 'minutely,hourly,alerts,flags',
				lat : latitude,		//纬度 latitude
				lon : longitude,	//经度 longitude
				lang : this.locale,
				units : 'metric',
				cnt : dMax.toString()
			};
			let url = 'https://api.openweathermap.org/data/2.5/forecast/daily';
			try {
				const session = new Soup.SessionAsync({ timeout : 10 });
				let message = Soup.form_request_new_from_hash('GET', url, params);
//~ https://api.openweathermap.org/data/2.5/forecast/daily?APPID=c93b4a667c8c9d1d1eb941621f899bb8&lat=28.1450774&lon=113.2384362&units=metric&cnt=13&lang=zh_cn
				session.queue_message(message, () => {
					const response = message.response_body.data;
					const obj = JSON.parse(response);
					if (obj.list[0].weather[0].icon) {
						lg("get:\tlongitude: " + longitude + "; latitude: " + latitude);
						//~ lg(JSON.stringify(obj, null, 4));
						this.parseWeather(obj);
					}
				});
			} catch (e) { throw e; }
		}

		local_gicon(str) {
			return Gio.icon_new_for_string(Me.path + "/weather-icon/" + str + ".svg");
		}

		easeMove(a, v, newX, newY) {
			a.visible = true;
			a.rotation_angle_z = 360;
			newX -= a.width / 2;  //中心点移动
			newY -= a.height / 2;
			a.set_pivot_point(0.5, 0.5);  //旋转等的中心

			a.ease({ x : newX, y : newY, rotation_angle_z : 0, duration : 1000, mode : Clutter.AnimationMode.EASE_OUT_BOUNCE, onComplete : () => {
						if (!v) a.visible = false;
						mlayout._queueUpdateRegions();
					} });
		}

		destroy() {
			for (let i of box) {
				mlayout.removeChrome(i);
				i.destroy();
			}
			box = [];  //全局变量，如果没清，重载时，会出 Object Clutter.Actor (0x557e77eb98f0), has been already deallocated
			super.destroy();  // Extension point conflict if no destroy.
		}
	});

class Extension {
	constructor(uuid) {
		this._uuid = uuid;

		ExtensionUtils.initTranslations();
	}

	enable() {
		this._indicator = new Indicator();
		Main.panel.addToStatusArea(this._uuid, this._indicator);
	}

	disable() {
		this._indicator.destroy();
		this._indicator = null;
	}
}

function init(meta) {
	return new Extension(meta.uuid);
}
