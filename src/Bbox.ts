/**
 *      Bbox.ts - a simple datastructure for a 3D bounding box
 *          It is the minimum orthonal (parallel to XYZ) Box that bounds a Shape
 *          Is used also for selecting and aligning 
 * */

import { Point, Vector, Shape, Obj, Vertex, Edge, Face, Shell, Solid } from './internal'
import { checkInput } from './decorators' // import directly because of error in ts-node
import { PointLike, isPointLike, MainAxis } from './internal' // types
import { roundToTolerance } from './utils'

import { SIDE_TO_AXIS } from './internal'

export class Bbox
{
    //// SETTINGS ////

    //// PROPERTIES

    _oc:any;
    _geom:any;
    _ocBbox:any = null;

    position:Point;
    bounds:Array<number> = null; // [xmin,xmax, ymin,ymax, zmin, zmax]

    /** Create 2D or 3D Bbox from two Point spanning up the box */
    constructor(min:PointLike=null, max:PointLike=null)
    {
        if (!min && !max)
        {
            // console.warn('Bbox:contructor: Created empty Bbox instance! Make sure you set it later');
            this._ocBbox = new this._oc.Bnd_Box_1();
            this._ocBbox.SetGap(0.0);
        }
        else
        {
            this.create(min,max);
        }

    }

    @checkInput(['PointLike', 'PointLike'], ['Vector', 'Vector'])
    create(min:PointLike, max:PointLike)
    {
        let minv = min as Vector; // auto converted
        let maxv = max as Vector; 
        
        // switch around if needed here
        let minX = (minv.x < maxv.x) ? minv.x : maxv.x;
        let maxX = (maxv.x > minv.x) ? maxv.x : minv.x;
        let minY = (minv.y < maxv.y) ? minv.y : maxv.y;
        let maxY = (maxv.y > minv.y) ? maxv.y : minv.y;
        let minZ = (minv.z < maxv.y) ? minv.z : maxv.z;
        let maxZ = (maxv.z > minv.z) ? maxv.z : minv.z;

        let minVec = new Vector(minX,minY,minZ);
        let maxVec = new Vector(maxX,maxY,maxZ);

        // check valid
        if (minVec.distance(maxVec) == 0)
        {
            console.error(`Bbox::constructor: Cannot create Bbox: Given points are the same`);
            return null;
        }
        // check if the bbox is 2D or 3D
        let sharedPlanes = minVec.sharedPlanes(maxVec);
        
        let sharedPlane;
        let is2D = false;

        if(sharedPlanes.length <= 2)
        {
            sharedPlane = sharedPlanes[0];
            is2D = true;
        }

        // We can continue creating the bbox
        this._ocBbox = new this._oc.Bnd_Box_2(minVec._toOcPoint(), maxVec._toOcPoint());
        this._ocBbox.SetGap(0.0)
        this.setBounds();

        // checks
        if (this._ocBbox.IsVoid())
        {
            console.warn(`Bbox: Created bad Bbox: please supply a min and max Vector!`);
        }
        else {
            this.updateFromOcBbox();
            console.info(`Bbox::constructor: Succefully created ${(is2D) ? '2D' : '3D'} Bbox with size [${this.width()},${this.depth()},${this.height()}] `);
        }

    }

    /** Set boundaries of Bbox from OC Bbox */
    setBounds()
    {
        // WORKAROUND FOR BUG in OPENCASCADE.JS: this._ocBbox.Get(xmin, ymin, zmin, xmax, ymax, zmax); // this gives an Error: RuntimeError: function signature mismatch11

        let min = new Vector()._fromOcPoint(this._ocBbox.CornerMin()).round(); // Correct bbox calculation very small numbers (e1-7)
        let max = new Vector()._fromOcPoint(this._ocBbox.CornerMax()).round();
        
        /* IMPORTANT: Sometimes we get inaccurate results. 
            For example X=[-1,1] for Shapes that are on XY plane
            For now we accept it in the raw Bbox OC instance, but correct in methods like is2D()
        */

        this.bounds = [min.x,max.x,min.y,max.y,min.z,max.z];
        
        return this.bounds;
    }

    /** Copy this Bounding Box */
    copy()
    {
        return new Bbox(this.min(), this.max());
    }

    /** Update properties (bounds and position) based on _ocBbox */
    updateFromOcBbox()
    {        
        this.setBounds();
        this.position = this.center();   
    }

    /** Get Point of left, front, bottom corner */
    min():Point
    {
        return new Point(this.bounds[0], this.bounds[2], this.bounds[4]);
    }

    /** Get maximum point (right,top,back) */
    max():Point
    {
        return new Point(this.bounds[1], this.bounds[3], this.bounds[5]);
    }

    /** Get center of Bounding Box */
    center():Point
    {
        let [xmin, xmax, ymin, ymax, zmin, zmax] = this.bounds;
        return new Point( xmin + (xmax - xmin)/2.0, ymin + (ymax - ymin)/2.0, zmin + (zmax - zmin)/2.0);
    }

    /** Get height of Bounding Box */
    height():number
    {
        let [xmin, xmax, ymin, ymax, zmin, zmax] = this.bounds;
        return (zmax-zmin);
    }

    /** Get depth of Bounding Box */
    depth():number
    {
        let [xmin, xmax, ymin, ymax, zmin, zmax] = this.bounds;
        return (ymax-ymin);
    }

    /** Get width of Bounding Box */
    width():number
    {
        let [xmin, xmax, ymin, ymax, zmin, zmax] = this.bounds;
        return (xmax-xmin);
    }

    /** Get frontal Face (3D) or Edge (2D) */
    front():Vertex|Edge|Face
    {
       return this._getSide('front');
    }

    /** Get back Face (3D) or Edge (2D) */
    back():Vertex|Edge|Face
    {
       return this._getSide('back');
    }

    /** Get left Face (3D) or Edge (2D) */
    left():Vertex|Edge|Face
    {
        return this._getSide('left');
    }

    /** Get left Face (3D) or Edge (2D) */
    right():Vertex|Edge|Face
    {
        return this._getSide('right');
    }

    /** Get left Face (3D) or Edge (2D) */
    top():Vertex|Edge|Face
    {
        return this._getSide('top');
    }

    /** Get left Face (3D) or Edge (2D) */
    bottom():Vertex|Edge|Face
    {
        return this._getSide('bottom');
    }

    /** Get one of the 8 Vertices of the Bbox 
     *  @param - a string like 'leftfront', 'bottomright'
     *  Order of sides does not matter
    */
    corner(where:string):Point // TODO: change to Point
    {
        const DEFAULT_SIDES: {[key:string]:string} = { x : 'left', y : 'front', z : 'bottom'};
        const SIDE_TO_BOUND: {[key:string]:number} = {
            left : 0,
            right : 1,
            front : 2,
            back: 3,
            bottom: 4,
            top: 5,
        }

        // we have zero size bbox (from a Vertex Shape)
        if(this.isPoint())
        {
            // there are not sides only the center
            return this.center();
        }
        
        // prepare where statement
        let sides = { ...DEFAULT_SIDES };
        where = where.toLowerCase();

        for ( const [side,axis] of Object.entries(SIDE_TO_AXIS)) 
        {
            if ( where.includes(side) )
            {
                let a = axis.replace('-', ''); // clean the direction
                sides[a] = side; // set side
            }
        }
        
        if(this.is2D())
        {
            let x = this.bounds[SIDE_TO_BOUND[sides.x]];
            let y = this.bounds[SIDE_TO_BOUND[sides.y]];
            return new Point(x,y,0);
        }
        else 
        {
            // 3D Bbox assembles the 3 Faces and returns the Point shared by all 3
            // xmin, xmax, ymin, ymax, zmin, zmax
            let x = this.bounds[SIDE_TO_BOUND[sides.x]];
            let y = this.bounds[SIDE_TO_BOUND[sides.y]];
            let z = this.bounds[SIDE_TO_BOUND[sides.z]];
            
            return new Point(x,y,z);
        }
    }

    /** Get the diagonal of Bounding Box as Vertex (zero size Bbox) or Edge */
    diagonal():Vertex|Edge
    {
        if(this.isPoint())
        {
            return this.center()._toVertex();
        }
        else if(this.is2D())
        { 
            return new Edge(this.corner('leftfront'), this.corner('rightback'));
        }
        else {
            return new Edge(this.corner('leftfrontbottom'), this.corner('rightbacktop'));
        }
    }

    /** Get position of Bbox based on percentages of x,y,z */
    @checkInput('PointLike', 'Point')
    getPositionAtPerc(p:PointLike, ...args):Point
    {
        let point = p as Point;

        let x = this.bounds[0] + this.width()*point.x;
        let y = this.bounds[2] + this.depth()*point.y;
        let z = this.bounds[4] + this.height()*point.z;

        return new Point(x,y,z);
    }

    /** Enlarge by offsetting current Bbox in all direction a given amount. Returns a new Bbox. */
    enlarged(amount:number):Bbox
    {
        let amountVec = new Vector(amount,amount,amount);
        // maintain 2D bbox
        if(this.is2D())
        {
            amountVec[this.axisMissingIn2D()] = 0;
        }
        return new Bbox(this.min().toVector().subtracted(amountVec), this.max().toVector().added(amountVec));
    }

    /** Return a new Bbox by adding another */
    added(other:Bbox):Bbox
    {
        let combinedBounds = [];
        this.bounds.forEach((b,i) => {
            // lower bound
            if(i%2==0)
            {
                combinedBounds[i] = (this.bounds[i] < other.bounds[i]) ? this.bounds[i] : other.bounds[i];
            }
            else {
                // upperbound
                combinedBounds[i] = (this.bounds[i] > other.bounds[i]) ? this.bounds[i] : other.bounds[i];
            }
        })
        return new Bbox(
            new Point(combinedBounds[0],combinedBounds[2], combinedBounds[4]),
            new Point(combinedBounds[1],combinedBounds[3], combinedBounds[5])
        );
    }

    // ==== TRANSFORMATIONS ====

    //// CALCULATED PROPERTIES ////

    /** Check if Bounding Box of zero size so a Point */
    isPoint():boolean
    {
        return (this.height() <= this._oc.SHAPE_TOLERANCE 
                    && this.width() <= this._oc.SHAPE_TOLERANCE 
                    && this.depth() <= this._oc.SHAPE_TOLERANCE);
    }
    
    /** Check if Bounding Box is 2D */
    is2D():boolean
    {
        // IMPORTANT: Bbox can be pretty inaccurate! Sometimes 1 unit on each axis for flat Shapes.
        // We introduce this TOLERANCE_2D
        const TOLERANCE_2D = 0.4;
        
        return (this.height() <= TOLERANCE_2D + this._oc.SHAPE_TOLERANCE 
                    || this.width() <= TOLERANCE_2D + this._oc.SHAPE_TOLERANCE 
                    || this.depth() <= TOLERANCE_2D + this._oc.SHAPE_TOLERANCE);
        
    }

    /** The axis that is missing in 2D bbox */
    axisMissingIn2D():MainAxis
    {
        if(!this.is2D())
        {
            return null;
        }

        if (this.height() <= this._oc.SHAPE_TOLERANCE)
        {
            return 'z';
        }
        else if(this.width() <= this._oc.SHAPE_TOLERANCE)
        {
            return 'x';
        }
        else {
            return 'y';
        }
    }

    /** Create 2D Rectangle Face from Bbox (DEBUG) */
    rect():Face
    {
        return new Face().makePlaneBetween(this.min(), this.max()); // Just a simple 2D Plane on XY plane ( normal parallel in Z)
    }

    /** returns a Box Shape for this Bbox */
    box():Solid
    {
        let boxShape = new Solid().makeBoxBetween(this.min(), this.max());
        return boxShape;
    }

    /** Gets the Edge seperating width in two equal halves */
    widthHalfLine():Edge
    {
        let [xmin, xmax, ymin, ymax, zmin, zmax] = this.bounds;
        return new Edge([xmin+this.width()/2,ymin,0],[xmin+this.width()/2, ymax, 0]);
    }

    /** Gets the Edge seperating depth in two equal halves */
    depthHalfLine():Edge
    {
        let [xmin, xmax, ymin, ymax, zmin, zmax] = this.bounds;
        return new Edge([xmin,ymin+this.depth()/2,0],[xmax, ymin+this.depth()/2, 0]);
    }

    /** Get Sub Shapes associated with given sides
        @param side - combinations of front|back|right|left|top|bottom
        NOTE: we use _getSide for now - but we might refactor
    */
    getSidesShape(sidesString:string):Face|Edge|Vertex
    {
        let sideShapes:Array<Face|Edge|Vertex> = [];

        Object.keys(SIDE_TO_AXIS).forEach( side => 
        {
            if( sidesString.includes(side))
            {
                let sideShape = this._getSide(side);
                sideShapes.push(sideShape)
            }
        });

        if(sideShapes.length == 0)
        {
            console.error(`Bbox::getSidesShape: Could not find any side Shapes with side string: "${sidesString}"`);
            return null;
        }
        else if(sideShapes.length == 1)
        {
            return sideShapes[0];
        }
        else {
            // For example when you have multiple side: topleftback
            // Now we have an array of sideShapes that are associated with given side strings
            // we want to have the topology that is the intersection of those
            let intersectionShape = null;

            sideShapes.every( (curShape,index,arr) => 
            {
                let nextShape = (index < arr.length) ? arr[index+1] : null;
                
                if (nextShape)
                {
                    if (!intersectionShape)
                    {
                        intersectionShape = curShape;
                    }
                    let intersections = intersectionShape._intersections(nextShape);
                    // if Shapes are not intersecting the user probably supplied a contradictionary sideString
                    if (!intersections)
                    {
                        throw new Error(`Bbox::getSidesShape: Cannot get Shape: Check for contradicting sides like "bottomtop"`);
                    }
                    else {
                        intersectionShape = intersections[0];
                    }
                }
                return true;
            })
            return intersectionShape;
        }
    }

    /** Get area of bbox */
    area():number
    {
        if(this.is2D())
        {
            return this.rect().area();
        }
        else {
            return roundToTolerance(this.box().faces().toArray().reduce( (sum, f) => sum + f.area(), 0));
        }
    }

    //// OPERATIONS / CHECKS ////

    contains(other:Shape):boolean
    {
        if(!Shape.isShape(other))
        {
            console.error(`Bbox:contains: Please supply a Shape!`)
            return false;    
        }

        if (other.type() == 'Vertex')
        {
            let vertex = other as Vertex;
            return ( vertex.x >= this.bounds[0] && vertex.x <=  this.bounds[1] 
            && vertex.y >= this.bounds[2] && vertex.x <=  this.bounds[3] 
            && vertex.z >= this.bounds[4] && vertex.z <=  this.bounds[5])
        }   
        else {
            return this._containsBbox(other.bbox());
        }
    }

    _containsBbox(other:Bbox):boolean
    {
        return (
                this.bounds[0] <= other.bounds[0] && this.bounds[1] >= other.bounds[1] // x
                && this.bounds[2] <= other.bounds[2] && this.bounds[3] >= other.bounds[3] // y
                && this.bounds[4] <= other.bounds[4] && this.bounds[5] >= other.bounds[5] // z
             )   
    }

    //// DATA EXPORTS ////

    toData():Array<number>
    {
        return this.bounds;
    }

    toString():string
    {
        return `Bbox<[${this.bounds}]`;
    }

    ///// UTILS ////

    /** Get side of Bbox - NOTE: Some sides can be zero length */
    // TODO: REFACTOR NEEDED
    _getSide(side:string):Vertex|Edge|Face
    {   
        const axis = SIDE_TO_AXIS[side];

        // check input
        if (!Object.keys(SIDE_TO_AXIS).includes(side))
        {
            console.error(`Bbox::_getSides: Please supply one of these sides: ${Object.keys(SIDE_TO_AXIS).join()}`);
            return null;
        }

        // zero size bbox ( for Vertex )
        if (this.isPoint())
        {
            return this.center()._toVertex();
        }

        if(this.is2D())
        {
            let bboxShape2D = this.rect(); // a Face plane 
            let axisAbs = axis.replace('-', '');
            if (axisAbs == this.axisMissingIn2D())
            {
                return bboxShape2D;
            }
            else {
                // one of the edge sides
                return bboxShape2D.directionMinMaxSelector(bboxShape2D.edges(), axis).specific() as Vertex|Edge|Face;
            }
        }
        else {
            let bboxSolid = this.box();
            return bboxSolid.directionMinMaxSelector(bboxSolid.faces(), axis).specific() as Vertex|Edge|Face;
        }   
        
    }

}