const Lang = imports.lang;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;

const Applet = imports.ui.applet;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const SignalManager = imports.misc.signalManager;

const Gio = imports.gi.Gio;
const Settings = imports.ui.settings;

const ICON_SCALE_FACTOR = .8; // for custom panel heights, 20 (default icon size) / 25 (default panel height)

function MyApplet(orientation, panel_height, instance_id) {
    this._init(orientation, panel_height, instance_id);
}

MyApplet.prototype = {
    __proto__: Applet.Applet.prototype,

    _init: function(orientation, panel_height, instance_id) {
        Applet.Applet.prototype._init.call(this, orientation, panel_height, instance_id);

        this.actor.remove_style_class_name("applet-box");
        this.actor.style="spacing: 5px;";
        
        this.settings = new Settings.AppletSettings(this, "systray-collapsible@hdodenhof.de", instance_id);
        this.settings.bindProperty(Settings.BindingDirection.IN, "new-icon-time", "new_icon_time", this.on_applet_clicked, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "expand-time", "expand_time", this.on_applet_clicked, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "expand-icon-name", "expand_icon_name", this._set_tray_button_icons, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "collapse-icon-name", "collapse_icon_name", this._set_tray_button_icons, null);

        this.tray_button = new St.Button();
		this.tray_button._isAdded = false;

        this.tray_is_expanded = false;
        this.tray_new_hidden_icon_added = false;

        this._set_tray_button_icons();

        this._signalManager = new SignalManager.SignalManager(this);

        let manager = new Clutter.BoxLayout( { spacing: 2 * global.ui_scale,
                                               homogeneous: true,
                                               orientation: Clutter.Orientation.HORIZONTAL });

        this.manager_container = new Clutter.Actor( { layout_manager: manager } );
        this.hidden_container = new Clutter.Actor( { } );

        this.actor.add_actor (this.manager_container);

        this.manager_container.show();
    },

    on_applet_clicked: function(event) {
    },

    on_applet_removed_from_panel: function () {
        this._signalManager.disconnectAllSignals();
    },

    on_applet_added_to_panel: function() {
        Main.statusIconDispatcher.start(this.actor.get_parent().get_parent());

        this._signalManager.connect(Main.statusIconDispatcher, 'status-icon-added', this._onTrayIconAdded);
        this._signalManager.connect(Main.statusIconDispatcher, 'status-icon-removed', this._onTrayIconRemoved);
        this._signalManager.connect(Main.statusIconDispatcher, 'before-redisplay', this._onBeforeRedisplay);
        this._signalManager.connect(Main.statusIconDispatcher, 'after-redisplay', this._onAfterRedisplay);
        this._signalManager.connect(Main.systrayManager, "changed", Main.statusIconDispatcher.redisplay, Main.statusIconDispatcher);
    },

    on_panel_height_changed: function() {
        Main.statusIconDispatcher.redisplay();
    },

    _onBeforeRedisplay: function() {
        let children = this.manager_container.get_children();
        for (var i = 0; i < children.length; i++) {
            children[i].destroy();
        }

        children = this.hidden_container.get_children();
        for (var i = 0; i < children.length; i++) {
            children[i].destroy();
        }

        this.tray_button._isAdded = false; /// if there was tray_button, it has just been destroyed
    },

    _onTrayIconAdded: function(o, icon, role) {
        try {
            let hiddenIcons = Main.systrayManager.getRoles();

            if (hiddenIcons.indexOf(role) != -1 ) {
                // We've got an applet for that
                return;
            }

            global.log("Adding systray: " + role + " (" + icon.get_width() + "x" + icon.get_height() + "px)");

            if (icon.get_parent())
                icon.get_parent().remove_child(icon);

            this.resize_icon(icon, role);

            /* dropbox, for some reason, refuses to provide a correct size icon in our new situation.
             * Tried even with stalonetray, same results - all systray icons I tested work fine but dropbox.  I'm
             * assuming for now it's their problem.  For us, just scale it up.
             */
            if (["dropbox"].indexOf(role) != -1) {
                icon.set_scale_full(global.ui_scale, global.ui_scale, icon.get_width() / 2.0, icon.get_width() / 2.0);
                global.log("   Full-scaled " + role + " (" + icon.get_width() + "x" + icon.get_height() + "px)");
            }

            this._insertStatusItem(icon, -1, role);

            let timerId = 0;
            let i = 0;
            timerId = Mainloop.timeout_add(500, Lang.bind(this, function() {
                this.resize_icon(icon, role);
                i++;
                if (i == 2) {
                    Mainloop.source_remove(timerId);
                }
            }));

        } catch (e) {
            global.logError(e);
        }
    },

    resize_icon: function(icon, role) {
        if (this._scaleMode) {
            let disp_size = this._panelHeight * ICON_SCALE_FACTOR;
            let size;
            if (icon.get_height() != disp_size) {
                size = disp_size;
            }
            else {
                // Force a resize with a slightly different size
                size = disp_size - 1;
            }

            // Don't try to scale buggy icons, give them predefined sizes
            // This, in the case of pidgin, fixes the icon being cropped in the systray
            if (["pidgin", "thunderbird"].indexOf(role) != -1) {
                if (disp_size < 22) {
                    size = 16;
                }
                else if (disp_size < 32) {
                    size = 22;
                }
                else if (disp_size < 48) {
                    size = 32;
                }
                else {
                    size = 48;
                }
            }

            icon.set_size(size, size);

            global.log("Resized " + role + " (" + icon.get_width() + "x" + icon.get_height() + "px)");
        }
        else {
            // Force buggy icon size when not in scale mode
            if (["pidgin", "thunderbird"].indexOf(role) != -1) {
                icon.set_size(16, 16);
                global.log("Resized " + role + " (" + icon.get_width() + "x" + icon.get_height() + "px)");
            }
        }
    },

    _onTrayIconRemoved: function(o, icon) {
        this.manager_container.remove_child(icon);
        this.hidden_container.remove_child(icon);
        icon.destroy();

        if (this._updateTray_buttonTimeoutId) { /// prevent several call
            Mainloop.source_remove(this._updateTray_buttonTimeoutId);
        }

        this._updateTray_buttonTimeoutId = Mainloop.timeout_add(1, Lang.bind(this, function() {
            this._updateTray_button();
        }));
    },

    _insertStatusItem: function(actor, position, role) {
        let children = this.manager_container.get_children();
        let i;
        for (i = children.length - 1; i >= 0; i--) {
            let rolePosition = children[i]._rolePosition;
            if (position < rolePosition) {
                this.manager_container.insert_child_at_index(actor, i + 1);
                break;
            }
        }
        if (i == -1) {
            // If we didn't find a position, we must be first
            this.manager_container.insert_child_at_index(actor, 0);
        }
        actor._rolePosition = position;

        actor._role = role; ///for _hide_icon function

        if (!this.tray_is_expanded){ /// ensure tray isn't expand otherwise the icon will be hide during collapse
            this.tray_new_hidden_icon_added = true;
            actor._timeout_id = Mainloop.timeout_add_seconds(this.new_icon_time, Lang.bind(this, function() {
                this.tray_new_hidden_icon_added = false;
                this._hide_icon(role);
            }));
        }

        if (this._updateTray_buttonTimeoutId) { /// prevent several call
            Mainloop.source_remove(this._updateTray_buttonTimeoutId);
        }

        this._updateTray_buttonTimeoutId = Mainloop.timeout_add(1, Lang.bind(this, function() {
            this._updateTray_button();
        }));
    },

    _hide_icon: function(role) {
		if (role == "tray_icon") {
			return;
		}

        let children = this.manager_container.get_children();
        for (var i = 0; i < children.length; i++) {
            if (children[i]._role == role ){ /// it is the icon to hide
		        this.manager_container.remove_child(children[i]);

                if (children[i]._timeout_id)
                    Mainloop.source_remove(children[i]._timeout_id);

                this.hidden_container.add_child(children[i])
            }
        }

        if (this._updateTray_buttonTimeoutId)/// prevent several call
            Mainloop.source_remove(this._updateTray_buttonTimeoutId);
        this._updateTray_buttonTimeoutId = Mainloop.timeout_add(1, Lang.bind(this, function() {
            this._updateTray_button();
        }));
    },

    _onDragBegin: function() {
        this._clean_timeout_id();
    },

    _onAfterRedisplay: function() {
        if (this._timeout_drag_Id)
            Mainloop.source_remove(this._timeout_drag_Id);
    },

    _set_tray_button_icons: function() {
        try {/// @koutch --- try loading expand icon ---
            let icon_open_file = Gio.File.new_for_path(this.expand_icon_name);
            if (icon_open_file.query_exists(null)) { /// this.expand_icon_name is a path
                let gicon_open = new Gio.FileIcon({ file: Gio.file_new_for_path(this.expand_icon_name) });
                let icon_open =  new St.Icon({ gicon: gicon_open, style_class: 'popup-menu-icon' });
                this.tray_icon_open = icon_open;
            }
            else {
                let icon_open = new St.Icon({ icon_name: this.expand_icon_name, style_class: 'popup-menu-icon' });
                this.tray_icon_open = icon_open;
            }
        }
        catch (e)  {
            global.logError('Failed to load icon file ' + this.expand_icon_name + ' : ' + e);
            let icon_open = new St.Icon({ icon_name: 'go-previous-symbolic', style_class: 'popup-menu-icon' });
            this.tray_icon_open = icon_open;
        }

        try {/// @koutch --- try loading collapse icon ---
            let icon_close_file = Gio.File.new_for_path(this.collapse_icon_name);
            if (icon_close_file.query_exists(null)) { /// this.collapse_icon_name is a path
                let gicon_close = new Gio.FileIcon({ file: Gio.file_new_for_path(this.collapse_icon_name) });
                let icon_close =  new St.Icon({ gicon: gicon_close, style_class: 'popup-menu-icon' });
                this.tray_icon_close = icon_close;
            }
            else {
                let icon_close = new St.Icon({ icon_name: this.collapse_icon_name, style_class: 'popup-menu-icon' });
                this.tray_icon_close = icon_close;
            }
        }
        catch (e)  {
            global.logError('Failed to load icon file ' + this.collapse_icon_name + ' : ' + e);
            let icon_close = new St.Icon({ icon_name: 'go-next-symbolic', style_class: 'popup-menu-icon' });
            this.tray_icon_close = icon_close;
        }

        if (this.tray_button._isAdded) {
        	this._updateTray_button();
    	}
    },

    _addTray_button: function() {
        this.tray_button = new St.Button({ child: this.tray_icon_close, style_class: 'panel-status-button' });

        this.tray_button.connect('button-release-event', Lang.bind(this, function(o,event){
            this._applet_context_menu.close();
            if (!global.settings.get_boolean('panel-edit-mode')){ ///
                if (event.get_button()==1)///left click
                    this._expandTray(this.expand_time);
            }
        }));

        let tray_icon_box = new St.Bin({ style_class: 'panel-status-button', reactive: true});
        tray_icon_box.add_actor(this.tray_button);
        this._insertStatusItem(tray_icon_box, 1000, 'tray_icon'); ///@koutch position = '1000' to ensure 'tray_icon_box' stay first

        this.tray_button._isAdded = true;
    },

    _updateTray_button: function(){
        if (!this.tray_button._isAdded) {
            this.tray_button._isAdded = true; /// to prevent serveral add
            this._addTray_button();
        }

        if (this.tray_is_expanded || this.tray_new_hidden_icon_added)
            this.tray_button.set_child(this.tray_icon_close);
        else
            this.tray_button.set_child(this.tray_icon_open);
    },

    _expandTray: function(time){
        if (!this.tray_is_expanded && !this.tray_new_hidden_icon_added) {
            this.tray_is_expanded = true;
            if (this._tray_buttonTimeoutId)
                Mainloop.source_remove(this._tray_buttonTimeoutId);
            this._tray_buttonTimeoutId = Mainloop.timeout_add_seconds(time, Lang.bind(this, function() {
                this._collapseTray();
            }));
            Main.statusIconDispatcher.redisplay();
        }
        else {
            this.tray_new_hidden_icon_added = false;
            this._collapseTray();
        }
    },

    _collapseTray: function(){
        this.tray_is_expanded = false;
        if (this.tray_button._isAdded)
            this._set_tray_button_icons();

        let children = this.manager_container.get_children();
        for (var i = 0; i < children.length; i++) {
        	this._hide_icon(children[i]._role)
        }

        if (this._tray_buttonTimeoutId)
            Mainloop.source_remove(this._tray_buttonTimeoutId);
    },

    _clean_timeout_id: function() {
        if (this._tray_buttonTimeoutId)
            Mainloop.source_remove(this._tray_buttonTimeoutId);
        if (this._updateTray_buttonTimeoutId)
            Mainloop.source_remove(this._tray_buttonTimeoutId);
        let children = this.hidden_container.get_children();
        for (var i = 0; i < children.length; i++) {
            if (children[i]._timeout_id)
                Mainloop.source_remove(children[i]._timeout_id);
        }
    }

};

function main(metadata, orientation, panel_height, instance_id) {
    let myApplet = new MyApplet(orientation, panel_height, instance_id);
    return myApplet;
}