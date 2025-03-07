/**
 * 
 *  ShapeCollection: A Collection with Shapes or ShapeCollections
 *   For example when with intersection and splits the Shapes into seperate Shape instances (Vertex, Edge, Wire, Face, Shell etc.)
 *
 *    ShapeCollection makes operating on multiple Shapes as easy as working on single Shapes (Inspired like JTS/GEOS). 
 *
 *   - TODO: Find a good strategy for this
 *   - TODO: The Scene is also a ShapeCollection => clear and advanced Object trees for navigation
 */

 import { isCoordArray, PointLike, isPointLike,PointLikeSequence, isPointLikeSequence, isCoord,Coord,isShapeTypes, PointLikeOrAnyShapeOrCollection, isPointLikeOrAnyShapeOrCollection,
         ShapeType, isShapeType, AnyShape, isAnyShape, AnyShapeOrCollection,isAnyShapeOrCollection,AnyShapeCollection, isAnyShapeCollection, MakeShapeCollectionInput, isMakeShapeCollectionInput, 
         ColorInput,isColorInput,Pivot,isPivot,AnyShapeSequence, isAnyShapeSequence, AnyShapeOrSequence,
         isAnyShapeOrSequence, isObjStyle, Bbox, Side} from './internal' // see types
 import { Obj, Point, Vector, Shape, Vertex, Edge, Wire, Face, Shell, Solid } from './internal'
 import { MeshShape, MeshShapeBuffer, MeshShapeBufferStats } from './internal' // types
 import { addResultShapesToScene, checkInput } from './decorators'; // Import directly to avoid error in ts-node/jest
 import type { ObjStyle } from './internal'; // NOTE: Vite does not allow re-importing interfaces and types
 import { flattenEntitiesToArray, flattenEntities } from './internal'  // utils
 import { Layout, LayoutOrderType, LayoutOptions } from './internal'

 import { SHAPE_EXTRUDE_DEFAULT_AMOUNT } from './internal';
 import { MeshingQualitySettings } from './types';

 // special libraries
 import chroma from 'chroma-js';


 export class ShapeCollection
 {
      /*  ShapeCollection cannot contain other ShapeCollections. Hierarchies are managed by Obj container class */
      _oc:any; // Don't set to null!
      _geom:any; // Set on init of Geom
      _obj:Obj = null; // Obj container
      shapes:Array<AnyShape> = []; // No ShapeCollection here
      _groups:{[key:string]:Array<AnyShape>} = {}; // mechanism to define groups within ShapeCollection (experimental)
   
      constructor(entities?:MakeShapeCollectionInput, ...args)
      {
         if (entities)
         {
            entities = (Array.isArray(entities) && !isCoordArray(entities)) ? entities.concat(args) : [entities, ...args];
            // NOTE: Array.flat() might be interesting, except it does collapse coord arrays. Manual way to flatten entities?
            entities = flattenEntities(entities); // NOTE: we could also use flattenEntitiesToArray
       
            this.fromAll(entities);
         }
      }

      /** Try to convert anything to a ShapeCollection */
      // We use an incremental way of iterating over collections (Arrays, ShapeCollections), testing the entities and adding them
      @checkInput('MakeShapeCollectionInput', 'auto') // no conversion of types
      fromAll(entities?:MakeShapeCollectionInput):AnyShapeCollection
      {
         // protect against single PointLike
         entities = (Array.isArray(entities) && !isCoordArray(entities)) ? entities : [entities]; 
         entities = flattenEntities(entities); // NOTE: we could also use flattenEntitiesToArray
         
         this._addEntities(entities); // pack all together
         this._setFakeArrayKeys();

         return this;
      }

      /** Class method */
      static fromAll(s:any,...args):ShapeCollection
      {
         let entities = (Array.isArray(s) && !isCoordArray(s)) ? s.concat(args) : [s, ...args];
         return new ShapeCollection().fromAll(entities);
      }

      /** Add entities (geometry and shapes) to Shape Collection */
      // Extra: add entities as group to organize shapes inside the ShapeCollection
      @checkInput(['MakeShapeCollectionInput', ['String', null]], ['auto','auto']) // no conversion of types
      _addEntities(entities?:MakeShapeCollectionInput, group?:string):AnyShapeCollection
      {
         if(entities == null)
         {
            return this;
         }
         
         let allEntities = flattenEntitiesToArray(entities);
         let addedShapes = []; // keep track of added Shapes for grouping
         
         allEntities.forEach( es => 
         {
            if (es === null)
            {
               console.warn('ShapeCollection::_addEntities: Skipped null!')
            }
            else if(isPointLike(es))
            {
               let vertex = (!(es instanceof Vertex)) ? new Vertex(es as PointLike) : es as Vertex;
               addedShapes.push(vertex);
               this.shapes.push(vertex); // IMPORTANT: don't make new Vertex is already one: otherwise problems with selectors!
            }
            // single ShapeCollection
            else if(isAnyShapeCollection(es))
            {
               // flatten an given ShapeCollection into this one
               let shapes = (es as ShapeCollection).shapes;
               this.shapes = this.shapes.concat(shapes);
               addedShapes = addedShapes.concat(shapes);
            }
            else if(isPointLikeSequence(es)) // NOTE: this needs to be later than single ShapeCollection
            {
               let points = new ShapeCollection(es); // bring all point sequences in collection
               points.forEach( e => 
               {
                  if(isPointLike(e))
                  {
                     let vertex = (!(e instanceof Vertex)) ? new Vertex(e) : e;
                     this.shapes.push(vertex);
                     addedShapes.push(vertex);
                  }
                  else if(isAnyShape(e))
                  {
                     if ( !((e as Shape).isEmpty()) )
                     {
                        this.shapes.push(e as Shape);
                        addedShapes.push(e);
                     }
                     else {
                        console.warn(`ShapeCollection::_addEntities: Empty Shape detected: ${e}. Skipped!`);
                     }
                  }
                  else if(isAnyShapeCollection(e))
                  {
                     let vertices = (e as ShapeCollection).getShapesByType('Vertex');
                     this.concat( vertices ); // append all vertices in collection
                     addedShapes = addedShapes.concat(vertices);
                  }
               })
            }
            // single Shape: also protect against empty Shapes
            else if(isAnyShape(es))
            {
               if (!((es as Shape).isEmpty()))
               {
                  this.shapes.push(es as AnyShape);
                  addedShapes.push(es);
               }
               else {
                  console.warn(`ShapeCollection::_addEntities: Empty Shape ("${es.type()}") detected. Skipped!`)
               }
            }
            else {
               console.warn(`ShapeCollection::_addEntities: Unknown entity ${es}: Skipped!`);
            }
         }
         );

         // order in group
         if (group)
         {
            if(this._groups[group])
            {
               this._groups[group].concat(addedShapes)
            }
            else {
               this._groups[group] = addedShapes;
            }
         }
         this._setFakeGroupKeys();

         return this;
      }

      /** Add entities as named group */
      @checkInput([['String', null], 'MakeShapeCollectionInput'], ['auto','auto']) // no conversion of types
      addGroup(group?:string, entities?:MakeShapeCollectionInput):AnyShapeCollection
      {
         let c = this._addEntities(entities, group);
         this._setFakeGroupKeys();
         return c;
      }

      _defineGroup(name:string, shapes:ShapeCollection)
      {
         if(!name)
         {
            return null;
         }

         if(this._groups[name])
         {
            this._groups[name] = this._groups[name].concat(shapes.toArray());
         }
         else {
            this._groups[name] = shapes.toArray();
         }

         this._setFakeGroupKeys();
      }

      /** Get available groups in this ShapeCollection */
      groups():Array<string>  
      {
         return Object.keys(this._groups);
      }

      /** Get shapes in group as ShapeCollection */
      getGroup(name:string)
      {
         if(name)
         {
            return (this._groups[name]) ? new ShapeCollection(this._groups[name]) : null;
         }
         return null;
      }

      /* EXPERIMENTAL: try to be compatible with Arrays by setting index keys on this instance */
      _setFakeArrayKeys()
      {
         // remove previous if any
         let i = 0;
         while(true)
         {
            if (this[i])
            {
               delete this[i];
               i++;
            }
            else {
               break;
            }
         }
         // add fake keys
         this.shapes.forEach( (shape,index) => this[index] = shape);
         
      }

      /** EXPERIMENTAL: directly access groups by adding property to instance */
      _setFakeGroupKeys()
      {
         Object.entries(this._groups).forEach(([k,v]) => { 
            if (k !== 'shapes')  // don't set shapes because this will break access to real data
            { 
               this[k] = new ShapeCollection(v) 
            }
         }); 
      }

      //// TRANFORMATIONS ////

      /** Export to OC ListOfStype, used for Splitter algoritm */
      _toOcListOfShape()
      {
         /* OC docs:
               - https://dev.opencascade.org/doc/refman/html/class_n_collection___list.html
         */
         let ocShapeList = new this._oc.TopTools_ListOfShape_1();
         this.shapes.forEach( shape => ocShapeList.Append_1(shape._ocShape));

         return ocShapeList;
      }

      toOcShapes():Array<any>
      {
         return this.shapes.map( shape => shape._ocShape );
      }

      /** Combine all children Shapes into one Compund Shape (for export) */
      toOcCompound()
      {
         /* OC docs: 
            - https://dev.opencascade.org/doc/refman/html/class_topo_d_s___compound.html
            -
         */
         let ocCompound = new this._oc.TopoDS_Compound(); 
         let ocSceneBuilder = new this._oc.BRep_Builder();
         let ocShapes = this.toOcShapes();
         ocSceneBuilder.MakeCompound(ocCompound);
         
         ocShapes.forEach(ocShape => {
            ocSceneBuilder.Add(ocCompound, ocShape);
         })
         
         return ocCompound;
      }

      getShapes():Array<AnyShape>
      {
         return this.shapes;
      }

      //// ARRAY API ////

      /** Array API - for consitent API with Array */
      get length()
      {
         return this.count();
      }

      /** Array API - For consistency with Array */
      @checkInput('AnyShapeSequence', 'ShapeCollection')
      concat(other:AnyShapeSequence):AnyShapeCollection
      {
         other = other as ShapeCollection;
         this.shapes = this.shapes.concat(other.shapes);
         this._setFakeArrayKeys();
         return this;
      }

      /** Array API - For consistency with Array */
      map(mapFunc: (element:AnyShape, index?:number, array?:Array<AnyShape>) => AnyShape ):AnyShapeCollection
      {
         // !!!! TODO: this functions takes it that we map new Shapes, this is not always the case with map !!!!
         return new ShapeCollection(this.shapes.map(mapFunc) as Array<any>); // avoid TS errors
      }

      /** Array API  */
      every(checkFunc: (element:AnyShape, index?:number, array?:Array<AnyShape>) => boolean ):boolean
      {
         return this.shapes.every(checkFunc);
      }

      /** Place this ShapeCollection (and all it's child Shapes) into the Obj container */
      setObj(obj:Obj)
      {
         this._obj = obj;
         
         this.shapes.forEach(s => {
            s._obj = obj;
         });
      }

      /** Add Shape to ShapeCollection */
      add(shapes?:AnyShapeOrCollection|Array<AnyShapeOrCollection>, ...args):AnyShapeCollection
      {
         this._addEntities([shapes, ...args])
         this._setFakeArrayKeys();

         return this;
      }

      /** Add Shape at beginning of collection */
      @checkInput('AnyShape', 'auto')
      prepend(shape:AnyShape):ShapeCollection
      {
         this.shapes = [shape].concat(this.shapes);
         return this;
      }

      /** Add Shape at beginning of collection */
      @checkInput('AnyShape', 'auto')
      prepended(shape:AnyShape):ShapeCollection
      {
         return new ShapeCollection([shape].concat(this.shapes));
      }

      @checkInput(['AnyShapeOrCollection','AnyShapeOrCollection'],['ShapeCollection','ShapeCollection'])
      replace(shapes:AnyShapeOrCollection, newShapes:AnyShapeOrCollection):ShapeCollection
      {
         this.remove(shapes as ShapeCollection)
         this.add(newShapes as ShapeCollection);

         return this;
      }

      //// SHAPE API ////

      /** Set attribute to all shapes */
      attribute(key:string, value:any):AnyShapeCollection
      {
         if(!(typeof(key) === 'string') || !value){ throw new Error(`ShapeCollection::atribute: Please supply a key and value! (ie. attribute('name', 'archiyou'))`) }

         this.forEach(shape => shape.attribute(key,value))

         return this;
      }

      /** Shape API - move all Shapes in ShapeCollection */
      @checkInput('PointLike','Vector') // this automatically transforms Types
      move(vector:PointLike, ...args):AnyShapeCollection
      {
         this.shapes.forEach( shape => shape.move(vector as Vector));

         return this;
      }

      /** Shape API - move a copy of all Shapes in ShapeCollection */
      @checkInput('PointLike','Vector') // this automatically transforms Types
      moved(vector:PointLike, ...args):AnyShapeCollection
      {
         let newCollection = this.copy();
         newCollection.shapes.forEach( shape => shape.move(vector as Vector)); // 

         return newCollection;
      }


      /**  Shape API - Move center of Collection to a given point */
      // NOTE: This might be a bit weird: Moving all Shapes in this Collection to the same coordinate */
      @checkInput('PointLike','Vector') // this automatically transforms Types
      moveTo(to:PointLike, ...args):AnyShapeCollection
      {
         let moveVec = (to as Vector).subtract(this.center().toVector());
         this.shapes.forEach( shape => shape.move(moveVec));

         return this;
      }

      /** Center Shape so that the center of the Shape is at the origin */
      moveToOrigin():AnyShapeCollection
      {
         this.moveTo(0,0,0);
         return this;
      }

      /** Shape API */
      @checkInput([ [Number,0],[Number,0], [Number,0], ['Pivot', 'center']], [Number,Number,Number,'auto']) // IMPORTANT: not able to directly convert Pivot to Vector because pivot needs current Shape (can that be accessed in decorator?)
      rotateEuler(degX?:number, degY?:number, degZ?:number, pivot?:PointLike):AnyShapeCollection
      {
         if (pivot === 'center'){ pivot = this.center();} // use center of ShapeCollection as pivot, not of individual Shape
         this.shapes.forEach( shape => shape.rotateEuler(degX, degY, degZ, pivot));
         return this;
      }

      /** Shape API */
      @checkInput([ [Number,0],[Number,0], [Number,0], ['Pivot', 'center']], [Number,Number,Number,'auto']) // IMPORTANT: not able to directly convert Pivot to Vector because pivot needs current Shape (can that be accessed in decorator?)
      rotatedEuler(degX?:number, degY?:number, degZ?:number, pivot?:PointLike):AnyShapeCollection
      {
         let newCollection = this.copy();
         if (pivot === 'center'){ pivot = this.center();} // use center of ShapeCollection as pivot, not of individual Shape
         newCollection.shapes.forEach( shape => shape.rotateEuler(degX, degY, degZ, pivot));
         return this;
      }

      /** Shape API - Rotate all Shapes around their centers with a given x,y,z angles */
      @checkInput('PointLike', Vector)
      rotate(r:PointLike, ...args):AnyShapeCollection // allows flattened notation rotate(180,0,-90)
      {
         let rv = r as Vector; // automatically converted to Vector
         let newCollection = new ShapeCollection();
         newCollection.shapes.forEach( shape => shape.rotateX(rv.x).rotateY(rv.y).rotateZ(rv.z) );
         return this;
      }

      /** Shape API - Rotate all Shapes around the x-axis with a given angle and given pivot (default: center) */
      @checkInput([Number,['Pivot','center']], [Number, 'auto'])
      rotateX(deg:number, pivot?:Pivot):AnyShapeCollection
      {
         if (pivot === 'center'){ pivot = this.center();} // use center of ShapeCollection as pivot, not of individual Shape
         this.shapes.forEach( shape => shape.rotateX(deg, pivot));
         return this;
      }

      /** Shape API - Rotate all Shapes around the y-axis with a given angle and given pivot (default: center) */
      @checkInput([Number,['Pivot','center']], [Number, 'auto'])
      rotateY(deg:number, pivot?:Pivot):AnyShapeCollection
      {
         if (pivot === 'center'){ pivot = this.center();} // use center of ShapeCollection as pivot, not of individual Shape
         this.shapes.forEach( shape => shape.rotateY(deg, pivot));
         return this;
      }

      /** Shape API - Rotate all Shapes around the z-axis with a given angle and given pivot (default: center of ShapeCollection) */
      @checkInput([Number,['Pivot','center']], [Number, 'auto'])
      rotateZ(deg:number, pivot?:Pivot):AnyShapeCollection
      {
         if (pivot === 'center'){ pivot = this.center();} // use center of ShapeCollection as pivot, not of individual Shape

         this.shapes.forEach( shape => shape.rotateZ(deg, pivot));
         return this;
      }

      /** Shape API - Rotate all Shapes around a specific axis with a given angle (default: [0,0,1]) and given pivot (default: center) */
      @checkInput([Number,['PointLike',[0,0,1]],['Pivot','center'] ], [Number, 'Vector', 'auto'])
      rotateAround(angle:number, axis?:PointLike, pivot?:Pivot):AnyShapeCollection
      {
         if (pivot === 'center'){ pivot = this.center();} // use center of ShapeCollection as pivot, not of individual Shape
         this.shapes.forEach( shape => shape.rotateAround(angle, axis, pivot));

         return this;
      }

      /** Scale entire ShapeCollection */
      @checkInput([[Number, 1.0]], ['auto'])
      scale(factor?:number):AnyShapeCollection
      {
         const pivot = this.center();
         this.shapes.forEach( shape => shape.scale(factor,pivot));
         return this;
      }

      /** Scale entire ShapeCollection and return copy */
      @addResultShapesToScene
      @checkInput([[Number, 1.0]], ['auto'])
      scaled(factor?:number):AnyShapeCollection
      {
         let newCollection = this._copy();
         newCollection.scale(factor);
         return newCollection;
      }

      /** Shape API - */
      alignByPoints(...args):AnyShapeCollection
      {
         console.warn('ShapeCollection.alignByPoint: **** TO BE IMPLEMENTED ****');
         return this;
      }

      /** Shape API - */
      alignedByPoints(...args):AnyShapeCollection
      {
         console.warn('ShapeCollection.alignedByPoint: **** TO BE IMPLEMENTED ****');
         return this;
      }

      /** Shape API - */
      rotateVecToVec(...args):AnyShapeCollection
      {
         console.warn('ShapeCollection.rotateVecToVec: **** TO BE IMPLEMENTED ****');
         return this;
      }

      /** Shape API - Make an geometric array by offset ShapeCollection */
      array(size:number|Array<number>, spacings:number|Array<number>):AnyShapeCollection
      {
         let newShapes = new ShapeCollection();
         this.shapes.forEach( shape => {
            newShapes.add( shape.array(size,spacings));
         });

         return newShapes;
      }

      /** Shape API */
      @checkInput([Number,'PointLike'], [Number, 'Point']) 
      _array1D(size:number, spacingOffset:PointLike):AnyShapeCollection
      {
         let newCollection = new ShapeCollection();
         this.shapes.forEach( shape => {
            newCollection.add( shape._array1D(size,spacingOffset));
            // NOTE: array always returns the original Shape too - we get doubles in new ShapeCollection
         });

         return newCollection.unique(); // Remove doubles with unique()
      }

      /** Shape API - Mirror Shapes in ShapeCollection with mirror plane defined by planeNormal and origin */
      @checkInput([['PointLike', [0,0,0]], ['PointLike', 'x']], ['Vector', 'Vector']) // the default mirror plane is the YZ plane with normal +X-axis at [0,0,0]
      mirrored(origin:PointLike, planeNormal:PointLike):AnyShapeCollection
      {
         let newCollection = new ShapeCollection();
         this.shapes.forEach( shape => {
            newCollection.add(shape.mirrored(origin, planeNormal));
         });
         return newCollection;
      }

      /** Shape API - Mirror Shapes relative to XZ plane with its collection center as pivot or given offset y-coord */
      @checkInput([[Number,null]], ['auto'])
      mirrorX(offset?:number):AnyShapeCollection
      {
         offset = offset || this.center().y; // based on given offset or center of collection

         this.shapes.forEach( shape => {
            shape.mirrorX(offset);
         })
         return this;
      }

      /** Shape API - Mirror copies of Shapes relative to XZ plane with its collection center as pivot or given offset y-coord */
      @checkInput([[Number,null]], 'auto')
      _mirroredX(offset?:number)
      {
         let newCollection = new ShapeCollection();
         offset = (offset !== null) ? offset : this.center().y; // based on given offset or center of collection
         this.shapes.forEach(shape => newCollection.add(shape._mirroredX(offset)));
         return newCollection;
      }

      /** Shape API - Mirror copies of Shapes relative to XZ plane with its collection center as pivot or given offset y-coord */
      @checkInput([[Number,null]], 'auto')
      mirroredX(offset?:number)
      {
         let newCollection = this.copy(); // automatically added to scene
         newCollection.mirrorX(offset);
         return newCollection;
      }

      /** Shape API - Mirror Shapes relative to XZ plane with its collection center as pivot or given offset x-coord */
      @checkInput([[Number,null]], 'auto')
      mirrorY(offset?:number):AnyShapeCollection
      {
         offset = offset || this.center().x; // based on given offset or center of collection
         this.shapes.forEach( shape => {
            shape.mirrorY(offset);
         })
         return this;
      }

      /** Shape API - Mirror copies of Shapes relative to XZ plane with its collection center as pivot or given offset x-coord */
      @checkInput([[Number,null]], 'auto')
      _mirroredY(offset?:number)
      {
         let newCollection = new ShapeCollection();
         offset = (offset !== null) ? offset : this.center().x // based on given offset or center of collection
         this.shapes.forEach(shape => newCollection.add(shape._mirroredY(offset)));
         return newCollection;
      }

      /** Shape API - Mirror copies of Shapes relative to XZ plane with its collection center as pivot or given offset x-coord */
      @checkInput([[Number,null]], 'auto')
      mirroredY(offset?:number)
      {
         let newCollection = this.copy();
         newCollection.mirrorY(offset);
         return newCollection;
      }

      /** Shape API - Mirror Shapes relative to XZ plane with its collection center as pivot or given offset z-coord */
      @checkInput([[Number,null]], 'auto')
      mirrorZ(offset?:number):AnyShapeCollection
      {
         this.shapes.forEach( shape => {
            shape.mirrorZ(offset);
         })
         return this;
      }

      /** Shape API - Mirror copies of Shapes relative to XZ plane with its collection center as pivot or given offset z-coord */
      @checkInput([[Number,null]], 'auto')
      _mirroredZ(offset?:number)
      {
         let newCollection = new ShapeCollection();
         offset = (offset !== null) ? offset : this.center().z; // based on given offset or center of collection
         this.shapes.forEach(shape => newCollection.add(shape._mirroredZ(offset)));
         return newCollection;
      }

      /** Shape API - Mirror copies of Shapes relative to XZ plane with its collection center as pivot or given offset z-coord */
      @checkInput([[Number,null]], 'auto')
      mirroredZ(offset?:number)
      {
         let newCollection = this.copy();
         offset = offset || this.center().z; // based on given offset or center of collection
         newCollection.mirrorZ(offset);
         return newCollection;
      }

      /** Shape API - offset Shapes in Collection */
      @checkInput([[Number,null],[String, null],['PointLike', null]], ['auto', 'auto', 'Vector'])
      offset(amount?:number, type?:string, onPlaneNormal?:PointLike):AnyShapeCollection
      {
         this.shapes.forEach( shape => (shape as Shape).offset(amount, type, onPlaneNormal) )

         return this;
      }

      /** Shape API - create copeis and offset Shapes in Collection  */
      @checkInput([[Number,null],[String, null],['PointLike', null]], ['auto', 'auto', 'Vector'])
      offsetted(amount?:number, type?:string, onPlaneNormal?:PointLike):AnyShapeCollection
      {
         let newCollection = new ShapeCollection();
         this.shapes.forEach( shape => {
            newCollection.add((shape as Shape).offsetted(amount, type, onPlaneNormal));
         });

         return newCollection;
      }

      /** Shape API - Extrude Shapes in ShapeCollection a certain amount in a given direction (default: [0,0,1]) */
      @checkInput([ [Number, SHAPE_EXTRUDE_DEFAULT_AMOUNT], ['PointLike', [0,0,1] ]], [Number, 'Vector'])
      extrude(amount?:number, direction?:PointLike):AnyShapeCollection
      {
         this.shapes.forEach( shape => {
            shape.extrude(amount, direction);
         });

         return this;
      }

      /** Shape API - Extrude Shapes in ShapeCollection a certain amount in a given direction (default: [0,0,1]) */
      @checkInput([ [Number, SHAPE_EXTRUDE_DEFAULT_AMOUNT], ['PointLike', [0,0,1] ]], [Number, 'Vector'])
      extruded(amount?:number, direction?:PointLike):AnyShapeCollection
      {
         let newCollection = new ShapeCollection();
         this.shapes.forEach( shape => {
            newCollection.add(shape.extruded(amount, direction));
         });

         return newCollection;
      }

      @checkInput([Number, [String, 'center']], [Number, String])
      thicken(amount:number,  direction?:string):ShapeCollection
      {
         this.forEach( shape => 
         {
           shape.thicken(amount, direction) 
         })
         return this;
      }

      /** Create a new ShapeCollection with thickened Shapes */
      @checkInput([Number, [String, 'all']], [Number, String])
      thickened(amount:number,  direction?:string):ShapeCollection
      {
         let newCollection = new ShapeCollection();
         this.shapes.forEach( shape => 
         {
            newCollection.add(shape.thickened(amount, direction));
         })
         return newCollection;
      }

      /* !!!! TODO  SHAPE API !!!!
         
         more operations that make sense:
         - thicken
         - sweep?
         - loft?

      */

      /** Shape API: Copy entire ShapeCollection and its Shapes and return a new one */
      _copy():ShapeCollection
      {
         let copiedShapes = this.shapes.map(s => s._copy() as Shape);
         return new ShapeCollection(copiedShapes);
      }

      /** Shape API: Copy entire ShapeCollection and its Shapes and return a new one (add to Scene) */
      // NOTE: this is a deep copy! We use this by default to be in line with Shape API
      copy():ShapeCollection
      {
         let copiedShapes = this.shapes.map(s => s._copy() as Shape);
         let newShapeCollection = new ShapeCollection(copiedShapes);
         newShapeCollection.name( this._geom.getNextLayerName( 'CopyOf' + this.getName() ));
         newShapeCollection.addToScene();
         return newShapeCollection;
      }

      /** Make new ShapeCollection without copying the Shapes */
      shallowCopy():ShapeCollection
      {
         return new ShapeCollection(this.shapes);
      }

      /** Shape API */
      type():string
      {
         // TODO: Distinguish between: Mixed and the same geometries (like ShapeCollection, EdgeCollection, VertexCollection etc)
         return 'ShapeCollection';
      }

      /** Shape API */
      isShape():boolean
      {
         return false; // Don't make this return - it turns out it's confusing!
      }

      /** Shape/ShapeCollection API consistency */
      isShapeCollection():boolean
      {
         return this.type() == 'ShapeCollection';
      }

      /* Test if a given object is a ShapeCollection */
      static isShapeCollection(obj:any): boolean
      {
         return (!obj) ? false : (obj.type && obj.type() == 'ShapeCollection');
      }

      /** Shape API */
      center():Point
      {
         switch (this.count())
         {
            case 0:
               return null;
            case 1:
               return (this.first().bbox()) ? this.first().bbox().center() : null; 
            default:
               return this.bbox().center();
         }
      }

      /** Shape API - get combined bbox of all Shapes in Collection */
      bbox():Bbox
      {
         let combinedBbox = this.first().bbox();
         this.shapes.forEach((shape,i) => {
            if(i > 0)
            {
               let bbox = shape.bbox();
               if(bbox)
               {
                  combinedBbox = combinedBbox.added(bbox);
               }
            }
         })

         return combinedBbox;
      }

      /** Shape API */
      _hashcode():string
      {
         // TODO: We need to have this to be consistent with Shape
         return null;
      }
      

      /** Shape API */
      @checkInput('PointLikeOrAnyShapeOrCollection', 'auto')
      _intersections(others:PointLikeOrAnyShapeOrCollection):ShapeCollection
      {         
         if(this.count() == 0)
         {
            // no Shapes in ShapeCollection
            return this;
         }

         if (isPointLike(others))
         {
            others = new Point(others)._toVertex(); // convert PointLike to Vertex so it is a Shape
         }

         let intersections = new ShapeCollection();
         this.forEach(shape => {
            let curIntersections = shape._intersections(others); // can be one shape of a ShapeCollection
            if (curIntersections)
            {
               intersections.add(curIntersections); // ShapeCollections will be flattened
            }
         })

         return intersections;
      }

      /** Create intersecting Shapes between Shapes in this collection and other Shape or Collection */
      @addResultShapesToScene
      @checkInput('PointLikeOrAnyShapeOrCollection', 'auto')
      intersections(others:PointLikeOrAnyShapeOrCollection):ShapeCollection
      {
         return this._intersections(others)
      }

      /** Get Shapes that intersect with given Shape(s) */
      @checkInput('PointLikeOrAnyShapeOrCollection', 'auto')
      intersecting(other:PointLikeOrAnyShapeOrCollection):ShapeCollection
      {
         let otherShapeOrCollection = isPointLike(other) ? new Point(other)._toVertex() : other; // convert PointLike to Vertex so it is a Shape
         
         let intersectors = new ShapeCollection();
         this.shapes.forEach( shape => 
         {
            if (otherShapeOrCollection._intersections(shape) != null)
            {
               intersectors.add(shape)
            }
         })

         return intersectors;
      }

      /** Alias for intersecting */
      @checkInput('PointLikeOrAnyShapeOrCollection', 'auto')
      intersectors(other:PointLikeOrAnyShapeOrCollection):ShapeCollection
      {
         return this.intersecting(other);
      }

      /** Shape API */
      @checkInput('PointLikeOrAnyShapeOrCollection', 'auto')
      contains(other:PointLikeOrAnyShapeOrCollection):boolean
      {
         return (this.find(shape => shape.contains(other)) != null);
      }

      /** Find Shapes within ShapeCollection that entirely contain given other Shape */
      @checkInput('PointLikeOrAnyShapeOrCollection', 'auto')
      containers(other:PointLikeOrAnyShapeOrCollection):ShapeCollection
      {
         return this.filter(shape => shape.contains(other));
      }
      
      /** Shape API */
      _intersectionsWithEdge()
      {
         // TODO
         return null;
      }

      /** Shape API */
      vertices():ShapeCollection
      {
         let allVerts = new ShapeCollection();
         this.shapes.forEach( s => { allVerts = allVerts.concat(s.vertices()) });
         return allVerts;
      }

      /** Shape API */
      edges():ShapeCollection
      {
         let allEdges = new ShapeCollection();
         this.shapes.forEach( s => { allEdges = allEdges.concat(s.edges()) });
         return allEdges;
      }

      /** Shape API */
      wires():ShapeCollection
      {
         let allWires = new ShapeCollection();
         this.shapes.forEach( s => { allWires.concat(s.wires()) });
         return allWires;
      }

      /** Shape API */
      faces():ShapeCollection
      {
         let allFaces = new ShapeCollection();
         this.shapes.forEach( s => { allFaces.concat(s.faces()) });
         return allFaces;
      }
      
      /** Shape API */
      shells():ShapeCollection
      {
         let allShells = new ShapeCollection();
         this.shapes.forEach( s => { allShells.concat(s.shells()) });
         return allShells;
      }

      /** Shape API */
      solids():ShapeCollection
      {
         let allSolids = new ShapeCollection();
         this.shapes.forEach( s => { allSolids.concat(s.solids()) });
         return allSolids;
      }

      /** Shape API */
      select(selectString:string=null):ShapeCollection
      {
         let selectedShapes = new ShapeCollection();
         this.all().forEach( shape => selectedShapes.concat(new ShapeCollection(shape.select(selectString))))
         return selectedShapes.distinct();
      }

      /**  Array API - Add Shape to ShapeCollection*/
      @checkInput('AnyShape', 'auto')
      push(shape:AnyShape):ShapeCollection
      {
         this.shapes.push(shape);
         return this;
      }

      /**  Array API - Add Shape to ShapeCollection*/
      pop():ShapeCollection
      {
         this.shapes.pop();
         return this;
      }

      /** Reverse order of the Shapes */
      reverse()
      {
         this.shapes.reverse();
         return this;
      }
      
      /** Shape API */
      removeFromScene()
      {
         this.shapes.forEach( shape => {
            shape.removeFromScene();
         })
      }

      /** Shape API */
      replaceShape(newShapes:Shape|ShapeCollection)
      {
         this.shapes.forEach( shape => {
            shape.replaceShape(newShapes);
         })
      }

      /** Shape API: Project 3D Shapes on XY plane */
      @checkInput([['PointLike',[0,1,0]], ['Boolean', false]],['Vector', 'auto'])
      _project(planeNormal?:PointLike, all?:boolean):ShapeCollection
      {
         const visibleShapes = this.filter( shape => shape.visible() === true)
         const ocCompoundShape = visibleShapes.toOcCompound(); // combine all Shapes in ShapeCollection as CompoundShape
         // We are hacking the Shape class a bit here to be able to use Shape._project on CompoundShape
         const tmpShape = new Shape();
         tmpShape._ocShape = ocCompoundShape; 
         return tmpShape._project(planeNormal,all);
      }

      /** Shape API: Public Project 3D Shapes on XY plane and add result to Scene */
      @addResultShapesToScene
      @checkInput([['PointLike',[0,1,0]], ['Boolean', false]],['Vector', 'auto'])
      project(planeNormal?:PointLike, all?:boolean):ShapeCollection
      {
          return this._project(planeNormal, all);
      }

      /** Shape API: Generate elevation from a given side without adding to Scene */
      @checkInput([['Side', 'top'], ['Boolean', false]], ['auto'])
      _elevation(side?:Side, all?:boolean):ShapeCollection
      {
         const visibleShapes = this.filter( shape => shape.visible() === true)
         const ocCompoundShape = visibleShapes.toOcCompound(); // combine all Shapes in ShapeCollection as CompoundShape
         // Again: We are hacking the Shape class a bit here
         const tmpShape = new Shape();
         tmpShape._ocShape = ocCompoundShape; 
         return tmpShape._elevation(side);
      }
      
      /** Shape API: Generate elevation from a given side and add to Scene */
      @addResultShapesToScene
      @checkInput([['Side', 'top'], ['Boolean', false]], ['auto'])
      elevation(side?:Side, all?:boolean):ShapeCollection
      {
         return this._elevation(side);
      }

      /** Shape API: Generate isometric view from Side or corner of ViewCube ('frontlefttop') or PointLike coordinate
       *      Does not add to Scene
       *      Use showHidden=true to output with hidden lines
       */
      _isometry(viewpoint:string|PointLike, showHidden:boolean=false):ShapeCollection
      {
         const visibleShapes = this.filter( shape => shape.visible() === true)
         const ocCompoundShape = visibleShapes.toOcCompound(); // combine all Shapes in ShapeCollection as CompoundShape
         // Again: We are hacking the Shape class a bit here
         const tmpShape = new Shape();
         tmpShape._ocShape = ocCompoundShape; 
         return tmpShape._isometry(viewpoint, showHidden);
      }

      /** Shape API: Generate isometric view from Side or corner of ViewCube ('frontlefttop') or PointLike coordinate
       *     Add to scene
      *      Use showHidden=true to output with hidden lines
      */
      @addResultShapesToScene
      isometry(viewpoint:string|PointLike, showHidden:boolean=false):ShapeCollection
      {
         return this._isometry(viewpoint, showHidden)
      }

      //// ARRAY LIKE API ////

      /** Array API - Alias for ForEach to have compatitibility with Array */
      forEach(func: (value: any, index: number, arr:Array<any>) => void ): ShapeCollection
      {
         this.shapes.forEach(func);
         return this;
      }
      
      /** Array API - Alias for sort to have compatitibility with Array */
      sort(func: (a: any, b: any) => number ):ShapeCollection
      {
         this.shapes.sort(func); // in place changing
         this._setFakeArrayKeys(); // IMPORTANT: otherwise indices are out of sync
         return this;
      }

      /** Array API - Alias for find to have compatitibility with Array */
      find(func: (value: any, index: number, arr:Array<any>) => any ): any
      {
         return this.shapes.find(func);
      }

      /** Array API - Filter Shapes in this Collection and return a new ShapeCollection */
      filter(func: (value: any, index: number, arr:Array<any>) => boolean ):ShapeCollection
      {
         return new ShapeCollection(this.shapes.filter(func));
      }

      reduce(func: (prevValue: number, curValue:AnyShape, index:number, arr:Array<AnyShape>) => number, startSum:number):number
      {
         return this.shapes.reduce(func, startSum);
      }

      /** Get Shapes at index. NOTE: We can also use the fake index keys like collection[0] */
      @checkInput(Number.isInteger, 'auto')
      at(index:number)
      {
         return this.shapes[index];
      }

      /** Exclude given Shape from current collection */
      not(shape:AnyShape):ShapeCollection
      {
         return this.filter(s => !s.same(shape))
      }

      /** Remove Shapes from ShapeCollection */
      @checkInput('AnyShapeOrCollection', 'ShapeCollection')
      remove(shapes:AnyShapeOrCollection, ...args): ShapeCollection
      {
         let removeShapes = shapes as ShapeCollection;

         this.shapes = this.shapes.filter( s => !removeShapes.has(s) );

         return this;
      }

      /** Remove everything */
      isEmpty():ShapeCollection
      {
         this.shapes = [];

         return this;
      }

      /** Alias for length */
      count():number
      {
         return this?.shapes?.length || 0;
      }

      // TODO
      specific()
      {
         /* To match API of Shape */
         return this.collapse();
      }

      //// NAVIGATING SHAPES ////

      /** Get Shapes of given type in ShapeCollection */
      @checkInput('ShapeType', 'auto')
      getShapesByType(type:ShapeType):ShapeCollection
      {
        let shapes = this.shapes.filter( s => s.type() == type );
        return new ShapeCollection(shapes); // always return ShapeCollection. Can be empty
        // TODO: make specific ShapeCollection: like VertexCollection?
      }

      @checkInput('ShapeTypes', Array)
      getShapesByTypes(types:Array<ShapeType>):ShapeCollection
      {
        let shapes = this.shapes.filter( s => types.includes(s.type()));
        return new ShapeCollection(shapes); // always return ShapeCollection. Can be empty
        // TODO: make specific ShapeCollection: like VertexCollection?
      }

      /** Shape API - Get all subshapes of type from Shapes in Collection */
      @checkInput('ShapeType', 'auto') 
      getSubShapes(type:ShapeType):ShapeCollection
      {
         const TYPE_TO_FUNC = { 'Vertex' : 'vertices', 'Edge' : 'edges', 'Wire' : 'wires', 'Face' : 'faces', 'Shell' : 'shells', 'Solid' : 'solids' }
         return this[TYPE_TO_FUNC[type]]();
      }

      /** Get first Shape of Collection */
      first():AnyShape
      {
         return this.shapes[0];
      }

      /** Get last Shape of Collection */
      last():AnyShape
      {
         return this.shapes[this.shapes.length - 1];
      }

      /** Get all direct children Shapes in this Collection */
      children():Array<AnyShape>
      {
         return this.shapes;
      }

      /** Alias: remove this eventually! */
      all():Array<AnyShape>
      {
         return this.children();
      }

      /** get lowest Shape type */
      lowestType():ShapeType
      {
         const TYPES_ORDERED = ['Solid', 'Shell', 'Face', 'Wire', 'Edge', 'Vertex'];

         let lowestType = null;
         let lowestTypeIndex = -1;
         this.shapes.forEach(s => {
            let i = TYPES_ORDERED.indexOf(s.type());
            if (i > lowestTypeIndex){
               lowestTypeIndex = i;
               lowestType = s.type();
            }
         });

         return lowestType;
      }

      /** check if this Collection has a specific instance of a Geometry */
      @checkInput('AnyShapeOrCollection', 'auto')
      has(s:AnyShapeOrCollection):boolean
      {
         if (Shape.isShape(s))
         {
            // NOTE: we can compare instances of AY Shapes or really underlying OC Shapes
            // return this.shapes.includes(s as AnyShape);
            return (this.shapes.find(shape => shape.same(s as Shape)) != null)
         }
         else {
            // is ShapeCollection
            let collectionShapes = (s as ShapeCollection).all();
            for (let i = 0; i < collectionShapes.length; i++)
            {
               let collShape = collectionShapes[i];
               if (this.shapes.find(shape => shape.same(s as Shape)) != null)
               {
                  return true;
               }
            }
            return false;
         }
      }

      /** Check if this Collection has a Shape of a given type */
      @checkInput('ShapeType', 'auto')
      hasType(type:ShapeType):boolean
      {
         return this.getShapesByType(type).length > 0; 
      }

      /** Array API - Get index of given Shape, if not exists -1 */
      @checkInput('AnyShape', 'auto')
      indexOf(s:Shape):number
      {
         return this.shapes.indexOf(s);
      }

      /** Array API - */
      @checkInput([Number.isInteger, Number.isInteger], [Number, Number])
      slice(start:number,end:number):ShapeCollection
      {
         return new ShapeCollection(this.shapes.slice(start,end));
      }

      /** Get the Shapes in current collection that are also in the other one with the same Geometry */
      @checkInput('AnyShapeOrCollection', 'auto')
      getEquals(others:AnyShapeOrCollection):ShapeCollection
      {  
         let equals = [];

         let othersCollection = (isAnyShape(others)) ? new ShapeCollection(others as Shape) :  others as ShapeCollection;

         this.shapes.forEach( curShape => 
         {
            let equalShape = othersCollection.shapes.find(otherShape => curShape.equals(otherShape as any)); // HACK: use any here to avoid TS errors for now
            if (equalShape){
                  equals.push(curShape)
            }
         });

         return new ShapeCollection(equals);
      }
      
      /** Combine two ShapeCollections and also try to upgrade Shapes that might be combined into higher order Shapes */
      // TODO: performance looks very slow. Can we improve this?
      @checkInput('AnyShapeCollection', 'auto')
      combine(other:ShapeCollection):ShapeCollection
      {
         if(!(other instanceof ShapeCollection))
         {
            console.error(`ShapeCollection::combine: Please supply other ShapeCollection to combine!`);
            return null;
         }
         else {
            this.concat(other);
            this.upgrade();

            return this;
         }
      }
      
      @checkInput('AnyShapeCollection', 'auto')
      combined(other:ShapeCollection):ShapeCollection
      {
         return this.copy().combine(other);
      }

      /** Try to combine collection of shapes into a higher order ShapeCollection */
      // TODO: What to do with the old Shapes when this collection is updated?
      upgrade():ShapeCollection
      {
         this._connectLinearShapes();
         // TODO: Combine Wires into Faces
         // TODO: Combine Faces into Solids

         return this;
      }

      /** Try to combine collection of shapes into a higher order ShapeCollection */
      upgraded():ShapeCollection
      {
         let newCollection = this.upgrade().copy();
         
         return newCollection
      }

      /** Check downgrade */
      checkDowngrade():ShapeCollection
      {
         this.shapes = this.map( shape => shape.checkDowngrade() ).toArray();

         return this;
      }

      /** Force unique Geometry based on the isEqual method ( not hash ) */
      unique():ShapeCollection 
      {
         // first use distinct to filter out Shapes with same hash
         let shapes:Array<AnyShape> = this.distinct().toArray();
         let usedShapes:Array<AnyShape> = []; // list of shapes already matched
         let uniqueShapes:Array<AnyShape> = []; 

         // TODO: ShapeCollection containing ShapeCollection?

         shapes.forEach( curShape => 
         {
            if (!usedShapes.includes(curShape))
            {
               uniqueShapes.push(curShape);
               let equalShapes = shapes.filter( testShape => curShape.equals(testShape as any) ); // HACK: avoid weird TS error for now
               usedShapes.concat(equalShapes.concat([curShape as Shape])); // remove equals shapes from consideration
            }
         })

         return new ShapeCollection(uniqueShapes);
      }

      /** Remove doubles based on OC hash */
      distinct():ShapeCollection
      {
         let distinctShapesByHash = {};

         this.forEach( shape => 
         {
            let hash = shape._hashcode();
            if (!distinctShapesByHash[hash])
            {
               distinctShapesByHash[hash] = shape;
            }
         })

         this.shapes = Object.values(distinctShapesByHash);
         this._setFakeArrayKeys();

         return this;
      }

      /** Try to sew Shapes (like Edges, Wires, Faces, Shells) together to create a Face, Shell, Solid or Compound  */
      _sewed():AnyShapeOrCollection
      {
         // !!!! ShapeUpgrade_UnifySameDomain 
         /* ocDocs:
               - BRepBuilder_Sewing: https://dev.opencascade.org/doc/occt-7.4.0/refman/html/class_b_rep_builder_a_p_i___sewing.html
               - general: https://dev.opencascade.org/doc/overview/html/occt_user_guides__modeling_algos.html#occt_modalg_8
               - ProcessIndicator: https://dev.opencascade.org/doc/occt-7.4.0/refman/html/class_message___progress_indicator.html
               - C++ code: https://github.com/i2e-haw-hamburg/opencascade/blob/master/src/BRepBuilderAPI/BRepBuilderAPI_Sewing.cxx
         */
         let ocSew = new this._oc.BRepBuilderAPI_Sewing(1e-6, true, true, true, false);
         this.shapes.forEach( curShape => ocSew.Add(curShape._ocShape));

         ocSew.Perform( new this._oc.Message_ProgressRange_1());
         let ocSewedShapeOrCompound = ocSew.SewedShape();
         if (!ocSewedShapeOrCompound.IsNull())
         {
            // We can have single Shape or a Compound
            let newOcType = new Shape()._getShapeTypeFromOcShape(ocSewedShapeOrCompound);
            if (newOcType != 'Compound')
            {
               // sewing created one new Shape of one type
               console.info(`ShapeCollection:: sewed: Sewing was succesfull and created one Shape of type '${newOcType}'!`); // TODO: geom
               let sewedShape = new Shape()._fromOcShape(ocSewedShapeOrCompound);
               return sewedShape as AnyShape;
            }
            else {
               // we got a Compound Shape: make a ShapeCollection out of it!
               let newShapeCollection = new Shape()._extractShapesFromOcCompound(ocSewedShapeOrCompound);
               console.info(`ShapeCollection:: sewed: Sewing resulting in more than one Shape. Returned a collection`); // TODO: geom
               return newShapeCollection as ShapeCollection;
            }
         }

         // unchanged Shape or ShapeCollection
         return this;

      }

     /** Combining Linear Shapes (Edges and Wires) into Wires connected by Vertices
     *    !!!! NEEDS WORK !!!!
     *    For Edges that overlap this does not work ( union could work: TODO )
     *    All other Shapes except Edges are kept in the collection
     */
      _connectLinearShapes()
     {
         let edges = this.getShapesByType('Edge'); 
         let wires = this.getShapesByType('Wire')
         let wireEdges = new ShapeCollection();
         wires.forEach( w => 
            {
               wireEdges.concat(w.edges());
            }
         ) 

         let allEdges = edges.concat(wireEdges);

         if (allEdges.length <= 1)
         {
            // no or only one Edge(s) to combine
            return this;
         }

         this.remove(edges);
         this.remove(wires);

         let groupedEdges:Array<Array<Edge>> = new Wire()._groupEdges(edges);
         // add Wires and remaining Edges back to Collection
         groupedEdges.forEach( edgeGroup => 
         {
            if(edgeGroup.length == 1)
            {
               this.add(edgeGroup); // single Edge Wire revert back to Edge
            }
            else {
               // make a Wire from the Edges
               this.add( new Wire().fromEdges(edgeGroup) ); // just add the newly combined Wire
            }
         });

         console.info(`ShapeCollection::_connectLinearShapes: Created ${this.getShapesByType('Wire').length} Wire(s). Remaining ${this.getShapesByType('Edge').length} Edges`);
         
         return this;
      }

      /** Removing Shapes that are contained by others in the Collection  */
      _removeContained():ShapeCollection
      {
         let notContainedShapes = [];
         for(let p = 0; p < this.shapes.length; p++)
         {
            let curShape = this.shapes[p];
            let isContained = false;
            for (let s = 0; s < this.shapes.length; s++)
            {
               let otherShape = this.shapes[s];
               if (curShape != otherShape)
               {
                  if(otherShape.contains(curShape))
                  {
                     isContained = true;
                     break;
                  }
               }
            }
            if (!isContained)
            {
               notContainedShapes.push(curShape);
            }
         }

         // remove Shapes
         this.shapes = notContainedShapes;
         this._setFakeArrayKeys();
         
         return this;
      }

      /** The same as _removeContained but returns a new Collection */ 
      _removedContained()
      { 
         let newColl = this.copy();
         newColl._removeContained();
         return newColl;
      }

      /** Test is the collections are the same */
      @checkInput('AnyShapeCollection', 'auto')
      equals(other:ShapeCollection):boolean
      {
         if (this.count() != other.count())
         {
            return false;
         }
         else 
         {
            return this.every( shape => {
               return other.find(otherShape => otherShape.equals(shape))
            })
         }
      }

      checkSingle():AnyShape|ShapeCollection
      {
         if (this.shapes.length == 1)
         {
            return this.shapes[0] as AnyShape;
         }
         else {
            return this; 
         }
      }

      /** Collapse ShapeCollection into one Shape if there is only one */
      collapse():AnyShape|ShapeCollection
      {
         if(this.shapes.length == 0)
         {
            return null;
         }
         else {
            return this.checkSingle();
         }
      }

      toArray(): Array<AnyShape>
      {
         return this.shapes;
      }

      //// BOOLEAN OPERATIONS (compatible with Shape API) ////

      /* Private Subtract without adding to scene */
      @checkInput('AnyShapeOrCollection', 'auto')
      _subtracted(other:AnyShapeOrCollection):ShapeCollection
      {
         let newShapes = new ShapeCollection();
         this.shapes.forEach( shape =>
            {
               if (isAnyShape(other))
               {
                  newShapes.add(shape._subtracted(other));
               }
               else { // iterate Shape collection
                  other.forEach(otherShape =>
                  {
                     newShapes.add(shape._subtracted(otherShape));
                  })
               }
            })

         return newShapes;
      }

      /** Subtract Shape or ShapeCollection from current ShapeCollection and return new ShapeCollection */
      @addResultShapesToScene
      @checkInput('AnyShapeOrCollection', 'auto')
      subtracted(other:AnyShapeOrCollection):ShapeCollection
      {
        return this._subtracted(other);
      }

      @checkInput('AnyShapeOrCollection', 'auto')
      subtract(other:AnyShapeOrCollection):ShapeCollection
      {
         this.shapes = this._subtracted(other).toArray();
         return this;
      }

      /** Shape API - Try to union all shapes in Collection (without adding to Scene) */
      @checkInput([['AnyShapeOrCollection',null ]], 'auto')
      _unioned(other?:AnyShapeOrCollection):ShapeCollection|AnyShape
      {
         // just add the other to collection, and then union
         if(other)
         {
            this.add(other);
         }

         let result = new ShapeCollection();
         let firstShape = this.first();

         this.forEach( shape => 
         {
            if (shape !== firstShape)
            {
               let r = firstShape._unioned(shape);
               result = (r instanceof ShapeCollection) ? result.concat(r) : result.add(r);
            }
         })

         return result.checkSingle()
      }

      /** Shape API - Try to union all shapes in Collection and add to Scene */
      @addResultShapesToScene
      @checkInput([['AnyShapeOrCollection',null ]], 'auto')
      unioned(other?:AnyShapeOrCollection):ShapeCollection|AnyShape
      {
         return this._unioned(other);
      }

      /** Shape API - Try to union all shapes in Collection */
      union():ShapeCollection|Shape
      {
         /* union is disabled for now because it can yield different results: 
         we need to be clear that a change of Shape can occur. So signify that we make a copy! */
         // TODO
         console.error('ShapeCollection.union: **** TO BE IMPLEMENTED ****');
         return null;
      }
      

      //// STYLING AND VISIBILITY WITH Obj API ////

      /**  Shape API - Add all shapes in the collection to the Scene */
      addToScene():ShapeCollection
      {
         // Keep Shapes in Collection together within layer
         this._geom.layer( this._geom.getNextLayerName(this.getName()));
         this.all().forEach(shape => shape.addToScene());
         this._geom.resetLayers(); // return active layer to scene
         return this;
      }

      color(color:any):ShapeCollection
      {
         this.forEach( shape => shape.color(color));

         return this;
      }
      
      /** Shape API - Style all Shapes in Collection */
      @checkInput('ObjStyle', 'auto')
      style(newStyle:ObjStyle):ShapeCollection
      {
         this.forEach( shape => shape.style(newStyle));
         return this;
      }

      /** Return this Shape wrapped with a Obj instance for adding it to the scene */
      object():Obj
      {
         // wrap in Obj and return
         let obj = new Obj(this);
         this._obj = obj;
         return this._obj;
      }

      /** Check if there is an Obj container tied to current ShapeCollection
       *    If so: return it, otherwise make one and return that
       */
      checkObj():Obj
      {
          if(!this._obj)
          {
              this.object();
          }
          return this._obj;
      }

      name(newName:string):ShapeCollection
      {
         // TODO: make a bit more robust!
         this.checkObj().name(newName);
         return this;
      }

      /** Get name of container Obj */
      getName()
      {
         return this?._obj?.name() || 'UnnamedShapeCollection';
      }

      /** Shape API - hide all Shapes in Collection */
      hide():ShapeCollection
      {
         this.forEach( shape => shape.hide());

         return this;
      }

      // TODO: .color, .

      //// LAYOUTING ALGORITHMS ////

      /** Layout Shapes on XY plane within a given Layout order */
      @checkInput([ ['String','sequence'], ['PointLike',[0,0,0]], ['Boolean', true], ['LayoutOptions', null]], ['String','Point','auto','auto'])
      layout(order:LayoutOrderType, position:PointLike, copy:boolean, options:LayoutOptions):ShapeCollection
      {
         // removed for now. See commit 9f7125202075db29d4ce1412e4b3be26d85dfdbd (GitLab) for last test version
         console.warn('To be implemented');
         return null;
      }

      _placeLine(shape:AnyShape, prevPosition:Point, margin:number=10, index:number):Point // returns last position
      {
         let workShapeBbox = shape.bbox();
         let offset = prevPosition.moved(workShapeBbox.width()/2);
         shape.moveTo(offset.x, offset.y, shape.center().z);
         
         return prevPosition.moved(workShapeBbox.width() + margin)
      }

      _packBinShapes(layoutCollection:ShapeCollection, position:Point, options:LayoutOptions)
      {
         // removed for now. See commit 9f7125202075db29d4ce1412e4b3be26d85dfdbd (GitLab) for last test version
         console.warn('To be implemented');
         return null;
      }

      _makeBinPackBox(shape:AnyShape, margin:number=10, index:number):any // TODO: typing
      {
         // removed for now. See commit 9f7125202075db29d4ce1412e4b3be26d85dfdbd (GitLab) for last test version
         console.warn('To be implemented');
         return null;
      }

      _calculateSizeSkewness(box:any)
      {
         // higher is more skewness
         let whSkew = box.width/box.height;
         let hwSkew = box.height/box.width;
         return (whSkew > hwSkew) ? whSkew : hwSkew;
      }

      //// OUTPUT DATA ////

      /** Shape API - Turn Edges (Line, Arc, Spline etc) into discreet (straight) edges for use in THREE JS
       *    Flattens all Shapes into one array of edges */
      toMeshShapes(quality?:MeshingQualitySettings):Array<MeshShape>
      {  
         let shapeMeshes:Array<MeshShape> = [];
         this.shapes.forEach( s => 
         {
            let meshShape = s.toMeshShape(quality);
            if (meshShape)
            {
               shapeMeshes.push(meshShape);
            }
         });

         console.info(`ShapeCollection:toMeshShapes: Output ${shapeMeshes.length} meshes of ${this.shapes.length} shapes!`);

         return shapeMeshes;
      }

      /** Output all Shapes in Collection to a single ShapeMeshBuffer */
      toMeshShapeBuffer(quality:MeshingQualitySettings):MeshShapeBuffer
      {         
         let meshShapes = this.toMeshShapes(quality);

         let numShapes = meshShapes.length;
         let numVertices = meshShapes.reduce( (acc,shapeMesh) => acc + shapeMesh.vertices.length, 0 );
         let numEdges = meshShapes.reduce( (acc,shapeMesh) => acc + shapeMesh.edges.length, 0 );
         let numFaces = meshShapes.reduce( (acc,shapeMesh) => acc + shapeMesh.faces.length, 0 );
         let numTriangles = meshShapes.reduce( (acc,shapeMesh) => acc + shapeMesh.faces.reduce( (sum, faceMesh) => sum + faceMesh.numTriangles, 0), 0 );

         let stats:MeshShapeBufferStats = { 
            numShapes: numShapes, 
            numVertices: numVertices,
            numEdges: numEdges,
            numFaces: numFaces,
            numTriangles: numTriangles
         }

         let meshShapeBuffer:MeshShapeBuffer = {
            verticesBuffer: [], // size of NumVertices*3
            verticesInfo: [], // info per Vertex
            edgesBuffer: [], // size of NumEdges*2*3
            lineEdgesInfo: [], // info per Edge
            trianglesVertices: [], // variable
            triangleIndices: [], // num triangles * 3
            trianglesVertexColors: [],
            triangleNormals: [],
            triangleUVs: [],
            trianglesInfo: [], // info per triangle
            stats: stats,
         }

         meshShapes.forEach( (curMeshShape, curMeshShapeIndex) =>
         {
            meshShapeBuffer.verticesBuffer = meshShapeBuffer.verticesBuffer.concat(
               curMeshShape.vertices.reduce( (sum, v) => sum.concat(v.vertices), []));
            
            // Per OC Edge we got sequential Vertices coords: either 6 coords for Line Edge, or a multiple of 3 coords
            // We need to output as coordinate pairs
            curMeshShape.edges.forEach( curShapeEdge => 
            {
               let lineSegmentsCoords = [];

               let numVertices = curShapeEdge.vertices.length/3;
               let coordBuffer = curShapeEdge.vertices;
               let prevVertexCoords = null;

               let lineSegmentIndexStart = meshShapeBuffer.edgesBuffer.length/6;
               let lineSegmentIndexEnd = lineSegmentIndexStart + numVertices-1;

               // Info per LineEdge
               let edgeInfo = { objId: curShapeEdge.objId, shapeId: curShapeEdge.ocId, subShapeType: 'Edge', indexInShape: curShapeEdge.indexInShape, 
                              color: chroma(curMeshShape?.style?.line?.color || '#333333').darken(0.5).num(), // darken lines a bit
                              edgeGroupLineSegmentsRange: [lineSegmentIndexStart,lineSegmentIndexEnd ] };

               // for the first line segment
               meshShapeBuffer.lineEdgesInfo.push(edgeInfo as any); // avoid TS warning

               for (let v = 0; v < numVertices; v++)
               {
                  // if more then 2 vertices: start pairing by adding previous coordBuffer first
                  if(v >= 2)
                  {
                     // add a edgeInfo object per line segment (2*3 coords)
                     meshShapeBuffer.lineEdgesInfo.push(edgeInfo as any); // avoid TS warning
                     lineSegmentsCoords = lineSegmentsCoords.concat(prevVertexCoords);
                  }
                  let vertexCoords = [coordBuffer[v*3],coordBuffer[v*3+1], coordBuffer[v*3+2]]; // [x,y,z]
                  lineSegmentsCoords = lineSegmentsCoords.concat(vertexCoords); // add vertex coords
                  prevVertexCoords = vertexCoords;  
               }

               meshShapeBuffer.edgesBuffer = meshShapeBuffer.edgesBuffer.concat(lineSegmentsCoords);
            })

            curMeshShape.faces.forEach( f => 
            {
               let lastVertexIndex = (meshShapeBuffer.trianglesVertices.length == 0 ) ? 0 : (meshShapeBuffer.trianglesVertices.length) / 3 ;
               meshShapeBuffer.trianglesVertices = meshShapeBuffer.trianglesVertices.concat(f.vertices); // triangle vertices buffer
               let newVertexIndices = f.triangleIndices.map(i => i + lastVertexIndex);
               meshShapeBuffer.triangleIndices = meshShapeBuffer.triangleIndices.concat(newVertexIndices);

               let newVertexColors = [];
               for(let v = 0; v < f.vertices.length/3; v++)
               {
                  let shapeColor = curMeshShape?.style?.fill?.color || chroma('#333333'); // TODO: nice defaults
                  let rgba = chroma(shapeColor).gl();
                  newVertexColors.push(rgba[0],rgba[1],rgba[2]);
               }
               meshShapeBuffer.trianglesVertexColors = meshShapeBuffer.trianglesVertexColors.concat( newVertexColors )
               meshShapeBuffer.triangleNormals = meshShapeBuffer.triangleNormals.concat(f.normals);
               meshShapeBuffer.triangleUVs = meshShapeBuffer.triangleNormals.concat(f.uvCoords);

               let trianglesInfo = [];
               let faceInfo = {  objId: f.objId, 
                                 shapeId: f.ocId,
                                 subShapeType: 'Face', 
                                 indexInShape: f.indexInShape,
                                 color: curMeshShape?.style?.fill?.color,
                                 faceGroupVertexIndices : newVertexIndices,
                                }
               // replicate info for numTriangles per Face
               for(let c = 0; c < f.numTriangles; c++)
               {
                  trianglesInfo.push(faceInfo);
               }

               meshShapeBuffer.trianglesInfo = meshShapeBuffer.trianglesInfo.concat(trianglesInfo);
            })

          
            // Info per entity
            meshShapeBuffer.verticesInfo = meshShapeBuffer.verticesInfo.concat( 
               curMeshShape.vertices.map( v => ({ objId: v.objId, shapeId: v.ocId, subShapeType: 'Vertex', indexInShape: v.indexInShape, color: chroma(curMeshShape?.style?.line?.color || '#333333').darken(0.5).num()  }) )
            );

         })

         // set line stats
         meshShapeBuffer.stats.numLines = meshShapeBuffer.edgesBuffer.length / 6;

         return meshShapeBuffer;
      }  

      toData():Array<Object> // TS typing
      {
         return this.shapes.map(shape => shape.toData());
      }

      toString():string
      {
         return `ShapeCollection<${this.shapes.map(s => s.toString())}>`;
      }

      /** Export (for now only Edges) to SVG */
      toSvg(withAnnotations:boolean=true):string
      {
         const edgeCollection = this.getShapesByType('Edge');
         
         if (edgeCollection.length == 0)
         {
            return null;
         }

         // to deal with flipped y-axis: mirror collection for now 
         const flippedEdgeCollection = edgeCollection._mirroredX(); // NOTE: mirroring in x-axis

         let svgPaths:Array<string> = [];

         flippedEdgeCollection.forEach( edge => 
         {
            svgPaths.push(edge.toSvg());
         })

         // NOTE: origin for SVG is in topleft corner (so different than world coordinates and doc space)
         const bbox = flippedEdgeCollection.bbox();
         const svgRectBbox = `${bbox.bounds[0]} ${bbox.bounds[2]} ${bbox.width()} ${bbox.depth()}`; // in format 'x y width height' 
         // TODO: bbox is not including dimension lines

         const svg = `<svg _bbox="${svgRectBbox}" _worldUnits="${this._geom._units}" stroke="black">
                        ${svgPaths.join('\n\t')}
                        ${(withAnnotations) ? this._getDimensionLinesSvgElems() : ''}
                     </svg>`

         return svg;
      }

      /** Add dimension lines that are tied to shapes in this Collection */
      _getDimensionLinesSvgElems():string
      {
         // TODO: have these arrow in editable files on disk
         const dimensionLines = this._geom._annotator.dimensionLines;

         let svgElems:Array<string> = [];
         let bboxHeight = this.bbox().depth(); // needed for flipping (maybe we should do something smarter here!)

         const edgeCollection = this.getShapesByType('Edge');
         edgeCollection.forEach( e => 
         {
            // dimension line that is linked to Edge we are about to export to SVG
            const linkedDimensionLines = dimensionLines.filter( dl => dl.shape && dl.shape.same(e) )
            linkedDimensionLines.forEach( d => 
            {
               svgElems.push(d.toSvg(bboxHeight));
            })
         });

         let dimSvg = svgElems.join('\n');
         return dimSvg;
        
      }
      
 }


 