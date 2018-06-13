// const fs = require('fs')
var logger = require('winston')

/** Get the JSON property `p` from the json data `o`
  * If the property does not exist, the function returns null
  */
const getProperty = (p, o) =>
  p.reduce((xs, x) =>
    (xs && xs[x]) ? xs[x] : null, o)

/** Get the simplified json representation for the model
  */
function simplifyModelicaJSON (model, parseMode) {
  // Validate the json structure
  const className = getClassName(model)
  if (this.validateClass(model) !== 0) {
    const msg = 'Error during validation of ' + className
    logger.error(msg)
    throw new Error(msg)
  }
  const within = model.within ? model.within[0] : undefined
  const pubParameters = this.getParameters(model, 'public')
  const proParameters = this.getParameters(model, 'protected')

  const pubInputs = isElementaryCDL(className)
                    ? getComponentsOfClass(model, 'Buildings.Controls.OBC.CDL.Interfaces.*Input', 'public')
                    : getComponentsOfClass(model, 'Interfaces.*Input', 'public')
  const proInputs = isElementaryCDL(className)
                    ? getComponentsOfClass(model, 'Buildings.Controls.OBC.CDL.Interfaces.*Input', 'protected')
                    : getComponentsOfClass(model, 'Interfaces.*Input', 'protected')
  if (proInputs.length !== 0 && !isElementaryCDL(className) && parseMode === 'cdl') {
    const msg2 = 'Received protected input connectors, which is an invalid specification.' +
    ' Check ' + className
    logger.error(msg2)
    throw new Error(msg2)
  }

  const pubOutputs = isElementaryCDL(className)
                     ? getComponentsOfClass(model, 'Buildings.Controls.OBC.CDL.Interfaces.*Output', 'public')
                     : getComponentsOfClass(model, 'Interfaces.*Output', 'public')
  const proOutputs = isElementaryCDL(className)
                     ? getComponentsOfClass(model, 'Buildings.Controls.OBC.CDL.Interfaces.*Output', 'protected')
                     : getComponentsOfClass(model, 'Interfaces.*Output', 'protected')
  if (proOutputs.length !== 0 && parseMode === 'cdl') {
    const msg3 = 'Received protected output connectors, which is an invalid specification.' +
    ' Check ' + className
    logger.error(msg3)
    throw new Error(msg3)
  }
  const pubModels = this.getModels(model, 'public')
  const proModels = this.getModels(model, 'protected')
  const extModels = this.getModels(model, 'extends')

  if (parseMode === 'cdl' && extModels.length !== 0) {
    const msg4 = 'Find extends statement in cdl models, which is not allowed.' +
    ' Check ' + className
    logger.error(msg4)
    throw new Error(msg4)
  }

  // Build a json object with all these data
  var info = getProperty(
    ['class_definition', 0, 'class_specifier', 'long_class_specifier', 'composition', 'comp_annotation', 'documentation', 'info'],
    model)
  if (info) {
    // Cut quotes
    info = info.slice(1, -1)
    info = this.updateImageLocations(info)
    // Replace the quotes, which are present in the image section
    info = info.replace(/\\"/g, '"')
  } else {
    logger.warn(className + ' has no info section.')
  }

  var venAnn = getProperty(
    ['class_definition', 0, 'class_specifier', 'long_class_specifier', 'composition', 'comp_annotation', 'vendor_annotation'],
    model
  )
  var vendorAnnotation
  if (venAnn) {
    vendorAnnotation = parseVendorAnnotation(venAnn)
  }

  var connections = this.getConnections(model)
  const allModels = pubModels.concat(proModels).concat(extModels)
  // Add connector targets if there are connections
  if (connections) {
    addConnectorTargets(connections, allModels, parseMode)
  }
  var data = {
    'modelicaFile': model.modelicaFile,
    'within': within,
    'topClassName': className,
    'comment': getComment(model).replace(/"/g, ''),
    'public': {
      'parameters': pubParameters,
      'models': pubModels,
      'inputs': pubInputs,
      'outputs': pubOutputs
    },
    'protected': {
      'parameters': proParameters,
      'models': proModels,
      'inputs': proInputs,
      'outputs': proOutputs
    },
    'extends': extModels,
    'vendorAnnotation': vendorAnnotation,
    'info': info,
    'connections': connections}
  cleanse(data)
  return data
}

function cleanse (obj) {
  if (obj) {
    Object.keys(obj).forEach(function (key) {
      // Get this value and its type
      var value = obj[key]
      var type = typeof value
      if (type === null || value === null) {
        delete obj[key]
      } else if (type === 'object') {
        // Recurse...
        cleanse(value)
        // ...and remove if now "empty"
        if (value && !Object.keys(value).length) {
          delete obj[key]
        }
      } else if (type === 'undefined' || type === 'null') {
        // Undefined, remove it
        delete obj[key]
      }
    })
  }
}

/** Gets the top-level comment, or else returns 'undefined'
  */
function getComment (model) {
  return getProperty(['class_definition', 0, 'class_specifier', 'long_class_specifier', 'comment'], model)
}

/**
  * Returns true if the type specifier is a model
  */
function isModel (typeSpecifier) {
  const nonModels = ['Modelica.SIunits', 'Buildings.Controls.OBC.CDL.Interfaces.']
  const isNotModel = nonModels.some(function (ele) {
    return (typeSpecifier.indexOf(ele) === 0)
  })
  return (isNotModel === false)
}

/** Get the path to the elements that contain the parameters, class instances etc.
  */
function getElements (model, prefix) {
  var elements
  if (prefix === 'public') {
    if (!model.class_definition[0].class_specifier.long_class_specifier.composition.element_list.element) {
      logger.debug(model.class_definition[0].class_specifier.long_class_specifier.name + ' has no equation section.')
      return undefined
    } else {
      elements = model.class_definition[0].class_specifier.long_class_specifier.composition.element_list.element.filter(function (obj) {
        if (obj.extends_clause) { return false } else { return true }
      })
    }
  } else if (prefix === 'protected') {
    if (model.class_definition[0].class_specifier.long_class_specifier.composition.prefixed_element) {
      elements = model.class_definition[0].class_specifier.long_class_specifier.composition.prefixed_element[0].element
    }
  } else if (prefix === 'extends') {
    if (!model.class_definition[0].class_specifier.long_class_specifier.composition.element_list.element) {
      logger.debug(model.class_definition[0].class_specifier.long_class_specifier.name + ' has no equation section.')
      return undefined
    } else {
      elements = model.class_definition[0].class_specifier.long_class_specifier.composition.element_list.element.filter(function (obj) {
        if (obj.extends_clause) { return true } else { return false }
      })
    }
  } else {
    const msg = 'Wrong argument value. Received "' + prefix + '". Check ' + getClassName(model)
    logger.error(msg)
    throw new Error(msg)
  }
  return elements
}

/** Returns 'true' if the className is an elementary type of CDL.
  */
function isElementaryType (className) {
  return ['Real', 'Integer', 'Boolean', 'String'].some(x => x === className) ||
         className.includes('Modelica.')
}

/** Returns 'true' if the className is an elementary block or connector of CDL.
  */
function isElementaryCDL (className) {
  const classes = [
    'OBC.CDL',
    'CDL.Continuous',
    'CDL.Conversions',
    'CDL.Discrete',
    'CDL.Integers',
    'CDL.Interfaces',
    'CDL.Logical',
    'CDL.Psychrometrics',
    'CDL.Routing',
    'CDL.SetPoints',
    'CDL.Types',
    'CDL.Utilities']
  return classes.some(x => className.includes(x))
}

/** Returns a json array with all blocks (or models), but not
  * the connectors.
  */
function getModels (model, prefix) {
  const elements = getElements(model, prefix)
  const classes = []
  if (elements) {
    // Filter for all classes of className
    const jsonClassNames = elements.filter(function (obj) {
      if (prefix === 'extends') {
        return isModel(obj.extends_clause.name)
      } else {
        if (obj.component_clause) {
          if (obj.component_clause.type_prefix === 'parameter') {
            return false
          } else {
            return isModel(obj.component_clause.type_specifier)
          }
        } else {
          return false
        }
      }
    })

    jsonClassNames.forEach(function (obj) {
      const declarations = (prefix === 'extends')
                           ? parseExtendsClause(obj)
                           : parseComponentDeclaration(obj.component_clause.component_list.component_declaration[0])
      const annotation = (prefix === 'extends')
                         ? null
                         : parseComponentAnnotation(obj.component_clause.component_list.component_declaration[0])
      const entry = Object.assign(
        {'className': (prefix === 'extends') ? obj.extends_clause.name
                                             : obj.component_clause.type_specifier}, declarations, annotation)
      classes.push(entry)
    })
  }
  return classes
}

/** Remove the trailing array descriptor. For example,
  * argument = abc[1] will return abc
  */
function removeTrailingArray (str) {
  const s = str.trim()
  if (s.endsWith(']')) {
    const idx = s.indexOf('[')
    if (idx === -1) {
      const msg = "Unexpected string '" + str + "'."
      logger.error(msg)
      throw new Error(msg)
    }
    return s.slice(0, idx)
  } else {
    return str
  }
}
/**
  * Returns a json array with all `connect` statements
  * the connectors
  */
function getConnections (model) {
  const className = getClassName(model)
  if (!model.class_definition[0].class_specifier.long_class_specifier.composition.equation_section) {
    // Class has no equation section
    logger.debug(className + ' has no equation section.')
    return undefined
  }
  const connections = []
  model.class_definition[0].class_specifier.long_class_specifier.composition.equation_section[0].equation.forEach(function (obj) {
    // equation also has elements that are not a connect_clause.
    // Here, we process only connect_clause
    if (obj.connect_clause) {
      connections.push(
        [
          {
            'instance': obj.connect_clause.component1[0],
            'connector': obj.connect_clause.component1[1]
          },
          {
            'instance': obj.connect_clause.component2[0],
            'connector': obj.connect_clause.component2[1]
          }
        ]
      )
    }
  })
  return connections
}
/** Return the class name
  */
function getClassName (model) {
  if (model === undefined) throw new Error('Argument to getClassName is undefined.')

  // First, check if there is a 'within xxxx;'
  const within = getProperty(['within', 0], model)
  // Get the model name
  const shortName = getProperty(
    ['class_definition', 0, 'class_specifier', 'long_class_specifier', 'name'], model)
  if (shortName) {
    return (within) ? within + '.' + shortName : shortName
  }

  const msg = 'Received wrong data structure for model ' + JSON.stringify(model, 2, null)
  logger.error(msg)
  throw new Error(msg)
}

/**
 * Returns a json array with all parameters and names
 */
function getParameters (model, prefix) {
  const elements = getElements(model, prefix)
  const pars = []
  if (elements) {
    // Filter for all parameters
    const jsonPars = elements.filter(function (obj) {
      // const out = JSON.stringify(obj, null, 2)
      if (obj.extends_clause) {
        return false
      } else {
        return obj.component_clause &&
               obj.component_clause.type_prefix === 'parameter'
      }
    })

    // Build the data structure for the parameters
    jsonPars.forEach(function (obj) {
      const declarations = parseComponentDeclaration(obj.component_clause.component_list.component_declaration[0])
      const annotation = parseParameterAnnotation(obj.component_clause.component_list.component_declaration[0])
      const entry = Object.assign(
        {'className': obj.component_clause.type_specifier},
          declarations,
          {'annotation': annotation})
      pars.push(entry)
    })
  }
  return pars
}

function parseParameterAssignments (classModification) {
  // There can be zero or multiple parameter assignments
  // have no modifications
  if (classModification === undefined) {
    return {}
  }
  var assignments = []
  const mod = classModification.modifications
  // Parse the parameter modifications, e.g., assignment of parameters in class instances
  // logger.debug('*** each is not handled ' + JSON.stringify(mod))
  for (var k = 0; k < mod.length; k++) {
    if (mod[k].prefix) {
      assignments.push({'name': mod[k].name, 'value': mod[k].value, 'isFinal': ((mod[k].prefix).indexOf('final') !== -1)})
    } else {
      assignments.push({'name': mod[k].name, 'value': mod[k].value, 'isFinal': false})
    }
  }
  return assignments
}

/** Return the argument converted to IP units
 */
function convertFromSIUnit (SIUnit) {
  const useIPUnit = true
  if (useIPUnit) {
    switch (SIUnit) {
      case 'K':
        return 'F'
      case 'Pa':
        return 'psi'
      case 'kg/s':
        return 'kg/s'
      case 'm3/s':
        return 'cfm'
      case 'm/s':
        return 'ft/s'
      default:
        return SIUnit
    }
  } else {
    switch (SIUnit) {
      case 'K':
        return 'degC'
      default:
        return SIUnit
    }
  }
}

/** Order the connections so that the first element is an input,
    and the second element is an output,
    and then return `data`.
    The argument `data` must be an array with all the data.
  */
function orderConnections (data) {
  // Check if portLinkTarget is an input
  function hasName (element, index, array) {
    // Return true if this element has the same name as the class of the connector
    // Use .trim() to make sure we compare for equal value
    return element.name.trim() === array[index].name.trim()
  }

  data.forEach(function (dataElement, index) {
    if (data[index].connections) {
      // data[index] has connections
      data[index].connections.forEach(function (connectStatement, idx) {
        const connector = data[index].connections[idx][0]
        var foundOutput = false
        // ////////////////////////////////////////////////////////////
        if (connector.connector === undefined) {
          // This is an input or an output of this class, rather than of
          // an instance of this class.
          if (data[index].outputs) {
            // Instance has outputs
            foundOutput = data[index].outputs.some(hasName, connector.class)
          }
        } else {
          // ////////////////////////////////////////////////////////////
          // This is a connector of an instance of this class.
          var allModels = null
          const havePublic = data[index].public && data[index].public.models
          const haveProtected = data[index].protected && data[index].protected.models
          const haveExtends = data[index].extends
          if (havePublic && haveProtected && haveExtends) {
            allModels = data[index].public.models.concat(data[index].protected.models)
                                                 .concat(data[index].extends)
          } else if (havePublic && haveProtected && !haveExtends) {
            allModels = data[index].public.models.concat(data[index].protected.models)
          } else if (havePublic && haveExtends && !haveProtected) {
            allModels = data[index].public.models.concat(data[index].extends)
          } else if (haveProtected && haveExtends && !havePublic) {
            allModels = data[index].protected.models.concat(data[index].extends)
          } else if (havePublic) {
            allModels = data[index].public.models
          } else if (haveProtected) {
            allModels = data[index].protected.models
          } else if (haveExtends) {
            allModels = data[index].extends
          }
          // Instance that contains this connector
          const instance = allModels.find(item => {
            const connectorClass = removeTrailingArray(connector.instance.trim())
            return item.name.trim() === connectorClass
          })
          // Check if this connector is an output
          if (instance.outputs) {
            foundOutput = instance.outputs.some(item => {
              return item.name.trim() === connector.connector.trim()
            })
          }
        }
        // Swap input and output if we found an output in the 0-th element
        // of the connector
        if (foundOutput) {
          const a = data[index].connections[idx][0]
          data[index].connections[idx][0] = data[index].connections[idx][1]
          data[index].connections[idx][1] = a
        }
      })
    }
  })
  return data
}

function parseClassModification (classModification, name) {
  // There can be zero or no match with name, and some
  // have no modifications
  if (classModification === undefined) {
    return {}
  }
  var ret = {}
  const mod = classModification.modifications
  for (var i = 0; i < mod.length; i++) {
    if (mod[i].name === name) {
      // Remove the name, as this will be the key of the new object
      var val = mod[i]
      delete val['name']
      // Add it to the return value
      ret = val
      break
    }
  }
  return ret
}

function parseParameterAnnotation (componentDeclaration) {
  const dialog = getProperty(['comment', 'annotation', 'dialog'], componentDeclaration)
  const venPair = getProperty(['comment', 'annotation', 'vendor_annotation'], componentDeclaration)
  var entry = {}
  if (dialog) {
    // Build the data structure
    dialog.forEach(obj => { entry[obj.name] = obj.value.replace(/"/g, '') })
  }
  // Set default group to Parameters and default tab to General
  if (!entry.tab) entry.tab = 'General'
  if (!entry.group) entry.group = 'Parameters'

  var vendorAnnotation
  if (venPair) {
    vendorAnnotation = parseVendorAnnotation(venPair)
  }
  return Object.assign({'dialog': entry},
    vendorAnnotation)
}

function parseComponentAnnotation (componentAnnotation) {
  const vendorAnnotation = getProperty(['comment', 'annotation', 'vendor_annotation'], componentAnnotation)
  if (vendorAnnotation) {
    return parseVendorAnnotation(vendorAnnotation)
  } else { return null }
}

function parseVendorAnnotation (vendorAnnotation) {
  var vendorEntry = {}
  const vendorName = vendorAnnotation.name
  vendorAnnotation.annotation.forEach(obj => {
    if (obj.name === 'haystack') {
      vendorEntry[obj.name] = haystackAnnotation(obj)
    } else if ((obj.name === 'brick')) {
      vendorEntry[obj.name] = obj.value.slice(1, -1)
    } else {
      vendorEntry[obj.name] = obj.value
    }
  })
  return {[vendorName]: vendorEntry}
}

function haystackAnnotation (obj) {
  var value = obj.value.slice(2, -2).trim().split(',\n')
  var haystackEntry = {}
  value.forEach(ele => {
    var temp = ele.split(':')
    if (!isNaN(temp[1].trim())) {
      haystackEntry[temp[0].trim().slice(2, -2)] = temp[1].trim()
    } else {
      haystackEntry[temp[0].trim().slice(2, -2)] = temp[1].trim().slice(2, -2)
    }
  })
  return haystackEntry
}

function parseComponentDeclaration (declaration) {
    // Get the name, value, comment, unit, min, max, displayUnit
  var comment = getProperty(['comment', 'string_comment'], declaration)
  if (comment) {
    comment = comment.replace(/"/g, '')
  } else {
    logger.warn('Instance "' + declaration.declaration.name + '" has no comment.')
  }
  var ret = {
    'name': declaration.declaration.name,
    'value': declaration.declaration.value,
    'comment': comment, // may be null, but will be removed later if it is null
    'unit': parseClassModification(declaration.declaration.class_modification, 'unit'),
    'displayUnit': parseClassModification(declaration.declaration.class_modification, 'displayUnit'),
    'quantity': parseClassModification(declaration.declaration.class_modification, 'quantity'),
    'min': parseClassModification(declaration.declaration.class_modification, 'min'),
    'max': parseClassModification(declaration.declaration.class_modification, 'max'),
    'nominal': parseClassModification(declaration.declaration.class_modification, 'nominal'),
    'start': parseClassModification(declaration.declaration.class_modification, 'start'),
    'modifications': parseParameterAssignments(declaration.declaration.class_modification)
  }
  // if (comment !== null) ret.comment = comment

  return ret
}

function parseExtendsClause (obj) {
  var ret = {
    'className': obj.extends_clause.name,
    'modifications': parseExtendsAssignments(obj.extends_clause.class_modification)
  }
  return ret
}

function parseExtendsAssignments (classModification) {
  if (classModification === undefined) {
    return null
  }
  var assignments = classModification.modifications.map(ele => {
    var temp
    if (ele.prefix) {
      if (ele.prefix === 'final') {
        temp = {
          'name': ele.name,
          'value': ele.value,
          'isFinal': (ele.prefix).indexOf('final') !== -1
        }
      } else if (ele.prefix.includes('redeclare')) {
        temp = {
          'prefix': ele.prefix,
          'className': ele.className,
          'name': ele.name,
          'modifications': parseParameterAssignments(ele.modification),
          'isFinal': (ele.prefix).indexOf('final') !== -1
        }
      }
    } else {
      temp = {
        'name': ele.name,
        'value': ele.value,
        'isFinal': false
      }
    }
    return temp
  })
  return assignments
}

/**
  * Returns a json array with all components that match
  * the regular expression 'className'.
  */
function getComponentsOfClass (model, className, prefix) {
  const elements = getElements(model, prefix)
  const classes = []
  if (elements) {
    // Filter for all classes of className
    const jsonClassNames = elements.filter(function (obj) {
      if (obj.extends_clause) {
        return false
      } else {
        return obj.component_clause &&
               obj.component_clause.type_specifier.match(className)
      }
    })

    jsonClassNames.forEach(function (obj) {
      const declarations = parseComponentDeclaration(obj.component_clause.component_list.component_declaration[0])
      const entry = Object.assign(
        {'className': obj.component_clause.type_specifier}, declarations)
      classes.push(entry)
    })
  }
  return classes
}

/**
  * Return the html_body, with the 'src' attribute of all 'img' elements
  * modified such that 'modelica://' is replaced with 'file:///'
  */
function updateImageLocations (htmlBody) {
  return htmlBody.replace(/modelica:\/\//g, '')
}

/**
 * Returns true if the class is a type

 * Currently, only Real, Boolean etc return true,
   but not user-defined types
 */
function isType (className) {
  const lisCon = ['Real', 'Integer', 'Boolean', 'String']
  return (lisCon.indexOf(className) >= 0)
}

/** Return 'connectors' with the element `linkTarget` added to all
    ports
*/
function addConnectorTargets (connectors, models, parseMode) {
  function getPortLinkTarget (obj) {
    const cla = removeTrailingArray(obj.instance)
    function equalsName (model) {
      // console.log('checking ' + model['name'] + ' ' + cla + ' ' + (cla === model['name']))
      return cla === model['name']
    }
    // Get the class name of the instance instanceName
    const i = models.findIndex(equalsName)
    if (i === -1) {
      const msg = 'Did not find model for connector ' + cla + ' in current model, may find it in extended models'
      logger.warn(msg)
      // return extModels[0].className
      return 'extends'
    }
    const className = models[i]['className']
    return className
  }

  connectors.forEach(function (connect) {
    // Connectors have two elements (the two arguments of the connect statement)
    connect.forEach(function (obj) {
      // Only add a target to the connectors that connect to a model instance,
      // but not to those that connect to an input, an output,
      // or an elementary CDL block (as for these, no documentation is generated)
      // const instanceName = obj.instance
      if (obj.connector) {
        const porLinTar = getPortLinkTarget(obj)
        if (porLinTar === 'extends') {
          obj['portLinkTarget'] = porLinTar
        } else {
          if (!isElementaryCDL(porLinTar)) {
            obj['portLinkTarget'] = porLinTar + '.' + obj.connector
          }
        }
      }
    })
  })
}

/** Validates the json structure of a Modelica class
  */
function validateClass (model) {
  var msg = []
  if (model.within && model.within.length !== 1) {
    msg.push('Require exactly zero or one within element, received ' + model.within.length +
    ' . Check ' + getClassName(model))
  }
  if (model.within && model.within.includes('Buildings.Controls.OBC')) {
    if (!(model.class_definition[0].class_prefixes === 'block' ||
        model.class_definition[0].class_prefixes === 'package')) {
      msg.push('Can only parse a block or package, but not a ' +
          model.class_definition[0].class_prefixes +
          '. Check ' + getClassName(model))
    }
  }
  if (model.class_definition.length !== 1) {
    msg.push('Must have exactly one class per Modelica file. Received ' +
        model.class_definition.length + ' classes. Check ' + getClassName(model))
  }
  for (var i = 0; i < msg.length; i++) {
    logger.error(msg[i])
    throw new Error('Error during validation of ' + getClassName(model))
  }
  return msg.length
}

module.exports.getProperty = getProperty
module.exports.orderConnections = orderConnections
module.exports.simplifyModelicaJSON = simplifyModelicaJSON
module.exports.isType = isType
module.exports.isElementaryCDL = isElementaryCDL
module.exports.isElementaryType = isElementaryType
module.exports.getClassName = getClassName
module.exports.getParameters = getParameters
module.exports.getModels = getModels
module.exports.getConnections = getConnections
module.exports.updateImageLocations = updateImageLocations
module.exports.addConnectorTargets = addConnectorTargets
module.exports.validateClass = validateClass
module.exports.removeTrailingArray = removeTrailingArray
module.exports.convertFromSIUnit = convertFromSIUnit
