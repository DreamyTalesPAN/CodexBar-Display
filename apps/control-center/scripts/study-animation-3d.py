"""Local procedural 3D control, NOT automatic image-to-3D reconstruction."""
import bpy, json, math, sys
from pathlib import Path
from mathutils import Vector

root=Path(sys.argv[sys.argv.index('--')+1])
def material(name,hexcolor):
    m=bpy.data.materials.new(name)
    m.diffuse_color=tuple(int(hexcolor[i:i+2],16)/255 for i in (0,2,4))+(1,)
    return m
def cube(name,loc,scale,mat):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc)
    o=bpy.context.object;o.name=name;o.scale=scale;o.data.materials.append(mat)
    return o
def ball(name,loc,scale,mat):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=6,radius=1,location=loc)
    o=bpy.context.object;o.name=name;o.scale=scale;o.data.materials.append(mat)
    return o
def point(x,y,depth=0):return Vector(((x-121)/20,depth,(108-y)/20))
def bone(name,a,b,r,mat):
    a,b=Vector(a),Vector(b)
    bpy.ops.mesh.primitive_cylinder_add(vertices=8,radius=r,depth=(b-a).length,location=(a+b)/2)
    o=bpy.context.object;o.name=name;o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();o.data.materials.append(mat)
    return o
for kind in ['robot','cat']:
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    scene=bpy.context.scene;scene.render.engine='BLENDER_WORKBENCH'
    scene.render.resolution_x=240;scene.render.resolution_y=128;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
    scene.display.shading.light='STUDIO';scene.display.shading.color_type='MATERIAL'
    scene.display.shading.show_shadows=True;scene.display.shading.show_cavity=True
    scene.display.shading.background_type='WORLD';scene.world.color=(0.025,0.04,0.075)
    scene.display.render_aa='OFF';scene.view_settings.view_transform='Standard'
    cat=kind=='cat';skin=material('orange' if cat else 'blue','EFAA58' if cat else '56A8E8')
    dark=material('dark','192B42');cream=material('cream','F9E6C6');metal=material('light','B2E7FF');apron=material('apron','59848A')
    floor=material('floor','38495B');window=material('window','243952');plant=material('plant','749B83')
    cube('floor',(0,0,-.1),(12,6,.15),floor)
    cube('backwall',(0,1.4,2.5),(12,.15,5),dark)
    cube('window',(-3.7,1.25,3.2),(2.8,.1,2.4),window)
    bone('window_mullion',(-3.7,1.14,2),(-3.7,1.14,4.4),.04,dark)
    ball('moon',(-3.1,1.08,3.8),(.3,.04,.3),cream)
    cube('pot',(3,.1,.4),(.7,.6,.8),apron)
    bone('plant',(3,.1,.8),(3,.1,1.8),.06,plant)
    bone('leaf',(3,.1,1.3),(3.4,.1,1.6),.09,plant)
    for x in [110,131]:
        bone('leg',point(x,91),point(x,102),.13,skin)
        cube('foot',point(x,104,-.08),(.42,.5,.18),skin)
    cube('torso',point(121,76), (1.15,.65,1.6),skin)
    cube('apron' if cat else 'control',point(121,76,-.36),(.8,.06,1.3) if cat else (.5,.06,.6),apron if cat else dark)
    if cat:
        ball('head',point(121,45),(0.9,.52,.76),skin)
        for x in [108,134]:
            bpy.ops.mesh.primitive_cone_add(vertices=3,radius1=.32,radius2=0,depth=.7,location=point(x,30))
            bpy.context.object.data.materials.append(skin)
    else:
        cube('head',point(121,45),(1.8,.85,1.4),skin)
        bone('antenna',point(121,30),point(121,23),.055,metal)
        ball('antenna_tip',point(121,22),(.13,.13,.13),metal)
    for x in [114,129]:ball('eye',point(x,45,-.5),(.13,.06,.17),dark)
    bone('mouth',point(118,53,-.52),point(125,53,-.52),.035,dark)
    bone('left_upper',point(110,68),point(101,81),.14,skin)
    bone('left_lower',point(101,81),point(104,89),.13,skin)
    bpy.ops.object.camera_add(location=(2.6,-12,5.0))
    cam=bpy.context.object;target=Vector((0,0,2.25));cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=11.4;scene.camera=cam
    trajectory=json.loads((root/kind/('trajectory-constrained.json' if cat else 'trajectory.json')).read_text())
    target_dir=root/kind/'three-d';target_dir.mkdir(exist_ok=True)
    dynamic=[]
    for i,w in enumerate(trajectory):
        for o in dynamic:bpy.data.objects.remove(o,do_unlink=True)
        dynamic=[]
        radius=math.hypot(*w);a=math.atan2(w[1],w[0])+(-1 if cat else 1)*math.acos(radius/32)
        shoulder=point(132,69);elbow=point(132+16*math.cos(a),69+16*math.sin(a));hand=point(132+w[0],69+w[1],-.15)
        dynamic.append(bone('right_upper',shoulder,elbow,.15,skin))
        dynamic.append(bone('right_lower',elbow,hand,.14,skin))
        dynamic.append(ball('joint',elbow,(.16,.16,.16),dark))
        dynamic.append(ball('hand',hand,(.17,.17,.17),skin if cat else metal))
        if cat:
            dynamic.append(cube('cup',hand+Vector((0,-.10,.17)),(.55,.45,.62),cream))
            dynamic.append(cube('coffee',hand+Vector((0,-.1,.49)),(.44,.35,.015),dark))
            dynamic.append(bone('cup_handle',hand+Vector((.35,-.1,.1)),hand+Vector((.35,-.1,.4)),.065,cream))
        scene.render.filepath=str(target_dir/f'frame-{i}.png');bpy.ops.render.render(write_still=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(target_dir/'fixture.blend'))
