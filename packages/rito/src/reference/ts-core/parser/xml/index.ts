export { DEFAULT_XML_PARSE_LIMITS, parseXml, XML_SOURCE_CODE_UNIT_LIMIT } from './parser';
export {
  childElements,
  findDescendants,
  findElements,
  findFirstDescendant,
  findFirstElement,
  getAttribute,
  getAttributeNS,
  hasAttribute,
  textContent,
} from './tree';
export type { XmlAttribute, XmlCdata, XmlDocument, XmlElement, XmlNode, XmlText } from './types';
export type { XmlParseLimits } from './parser';
